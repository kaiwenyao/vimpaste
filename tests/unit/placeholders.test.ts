import { describe, expect, it } from 'vitest'
import { findPlaceholders, MAX_SCAN_LENGTH } from '../../src/detection/placeholders'

function texts(text: string): string[] {
  return findPlaceholders(text).map((m) => m.text)
}

describe('findPlaceholders', () => {
  it('识别核心 K3s 样例中的 YOUR_TOKEN（单引号内）且计数为 1', () => {
    const k3s = [
      "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\",
      '  --server https://10.10.0.11:6443 \\',
      '  --node-ip 10.10.0.12 \\',
      '  --advertise-address 10.10.0.12 \\',
      '  --flannel-iface eth1',
    ].join('\n')
    const matches = findPlaceholders(k3s)
    expect(matches.map((m) => m.text)).toEqual(['YOUR_TOKEN'])
    expect(k3s.slice(matches[0].start, matches[0].end)).toBe('YOUR_TOKEN')
  })

  it('识别方案要求的裸词占位符', () => {
    for (const word of ['YOUR_TOKEN', 'YOUR_API_KEY', 'REPLACE_ME', 'CHANGE_ME']) {
      expect(texts(`echo ${word}`)).toEqual([word])
    }
    expect(texts('echo YOUR_SECRET_HERE')).toEqual(['YOUR_SECRET_HERE'])
  })

  it('识别尖括号占位符', () => {
    expect(texts('ping <IP_ADDRESS>')).toEqual(['<IP_ADDRESS>'])
    expect(texts('ssh <HOST>')).toEqual(['<HOST>'])
    expect(texts('kubectl apply -f <TOKEN>.yaml')).toEqual(['<TOKEN>'])
  })

  it('识别大括号与 $ 前缀占位符', () => {
    expect(texts('echo ${TOKEN}')).toEqual(['${TOKEN}'])
    expect(texts("echo '${PASSWORD}'")).toEqual(['${PASSWORD}'])
    expect(texts('echo $YOUR_TOKEN')).toEqual(['$YOUR_TOKEN'])
  })

  it('重复出现分别计数', () => {
    expect(texts('${TOKEN} ${TOKEN} ${TOKEN}')).toEqual(['${TOKEN}', '${TOKEN}', '${TOKEN}'])
    expect(findPlaceholders('a REPLACE_ME b REPLACE_ME').length).toBe(2)
  })

  it('嵌套写法只标记一次（优先长结构）', () => {
    expect(texts('echo ${YOUR_TOKEN}')).toEqual(['${YOUR_TOKEN}'])
    expect(texts('echo <YOUR_TOKEN>')).toEqual(['<YOUR_TOKEN>'])
    expect(texts('echo $YOUR_TOKEN extra')).toEqual(['$YOUR_TOKEN'])
  })

  it('环境变量赋值：值是占位内容时标记值本身（DeepSeek 样例）', () => {
    const text = [
      'export API_KEY="你的 API Key"',
      'export BASE_URL="https://api.deepseek.com"',
      'python chatbot.py',
    ].join('\n')
    const matches = findPlaceholders(text)
    expect(matches.map((m) => m.text)).toEqual(['你的 API Key'])
    expect(matches[0].kind).toBe('env')
    expect(text.slice(matches[0].start, matches[0].end)).toBe('你的 API Key')
  })

  it('环境变量赋值：无 export 前缀、中文、引号内外与常见占位值', () => {
    expect(texts('API_KEY="你的 Key"')).toEqual(['你的 Key'])
    expect(texts('TOKEN=你的APIKey')).toEqual(['你的APIKey'])
    expect(texts("export DB_PASSWORD='在此填写密码'")).toEqual(['在此填写密码'])
    expect(texts('export DEEPSEEK_API_KEY=sk-xxx')).toEqual(['sk-xxx'])
    expect(texts('export OPENAI_API_KEY=<your-api-key>')).toEqual(['<your-api-key>'])
    expect(texts('export AUTH_TOKEN=...')).toEqual(['...'])
  })

  it('环境变量赋值：行中 export 与命令前缀形式', () => {
    expect(texts('cd /app && export API_KEY="你的 API Key" && python chatbot.py')).toEqual([
      '你的 API Key',
    ])
    expect(texts('FOO="你的 Key" python chatbot.py')).toEqual(['你的 Key'])
  })

  it('环境变量赋值：密钥类变量空值连引号标记，普通变量不标记', () => {
    expect(texts('export DEEPSEEK_API_KEY=""')).toEqual(['""'])
    expect(texts("export GITHUB_TOKEN=''")).toEqual(["''"])
    expect(texts('export DEBUG=""')).toEqual([])
    // 非空 CJK 值一律视为占位（设计上允许此类误判，见 placeholders.ts）
    expect(texts('export GREETING="你好"')).toEqual(['你好'])
  })

  it('环境变量赋值：$ 引用与小写变量名不标记', () => {
    expect(texts('export TOKEN=$MY_TOKEN')).toEqual([])
    expect(texts('export api_key="你的 key"')).toEqual([])
  })

  it('环境变量赋值：真实值不标记，已有占位符不重复标记', () => {
    expect(texts('export BASE_URL="https://api.deepseek.com"')).toEqual([])
    expect(texts('export NODE_ENV=production')).toEqual([])
    expect(texts("K3S_TOKEN='abc' sh -s -")).toEqual([])
    expect(texts("curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s -")).toEqual([
      'YOUR_TOKEN',
    ])
  })

  it('环境变量赋值：多个赋值分别计数且按位置排序', () => {
    const text = 'export API_KEY="你的"\necho YOUR_TOKEN\nexport FLAG=xxx'
    expect(texts(text)).toEqual(['你的', 'YOUR_TOKEN', 'xxx'])
  })

  it('误判边界：普通变量与常用符号不标记', () => {
    expect(texts('export PATH=$PATH:/usr/local/bin')).toEqual([])
    expect(texts("K3S_TOKEN='abc' sh -s -")).toEqual([])
    expect(texts('grep -rn "TODO" .')).toEqual([])
    expect(texts('cat << EOF > out.txt')).toEqual([])
    expect(texts('wc -l < in.txt > out.txt')).toEqual([])
    expect(texts('kill -9 $PID; sleep 2')).toEqual([])
    expect(texts('echo 2>&1 | tee log')).toEqual([])
  })

  it('小写与混合大小写不标记', () => {
    expect(texts('echo your_token change_me')).toEqual([])
    expect(texts('echo Token TOKEN')).toEqual([])
  })

  it('多行文本与位置正确', () => {
    const text = 'line1\nTOKEN=<HOST>\nline3'
    const matches = findPlaceholders(text)
    expect(matches.map((m) => m.text)).toEqual(['<HOST>'])
    expect(matches[0].start).toBe(text.indexOf('<HOST>'))
  })

  it('空文本与超长文本安全返回', () => {
    expect(findPlaceholders('')).toEqual([])
    expect(findPlaceholders('x'.repeat(MAX_SCAN_LENGTH + 1))).toEqual([])
  })
})
