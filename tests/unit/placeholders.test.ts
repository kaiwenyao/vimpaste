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
