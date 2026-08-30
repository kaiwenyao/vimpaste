import { describe, expect, it } from 'vitest'
import { detectLanguage, heuristicDetect, languageLabel } from '../../src/detection/language'

const K3S = [
  "curl -sfL https://get.k3s.io | K3S_TOKEN='YOUR_TOKEN' sh -s - server \\",
  '  --server https://10.10.0.11:6443 \\',
  '  --node-ip 10.10.0.12 \\',
  '  --advertise-address 10.10.0.12 \\',
  '  --flannel-iface eth1',
].join('\n')

describe('heuristicDetect（同步、Shell 优先）', () => {
  it('核心 K3s 样例识别为 shell', () => {
    expect(heuristicDetect(K3S)).toBe('shell')
  })

  it('shebang 强特征识别为 shell', () => {
    expect(heuristicDetect('#!/usr/bin/env bash\nset -euo pipefail\necho hi')).toBe('shell')
  })

  it('单行安装脚本（curl | sh）识别为 shell', () => {
    expect(heuristicDetect('curl -fsSL https://example.com/install.sh | sh')).toBe('shell')
  })

  it('常见命令 + 续行识别为 shell', () => {
    expect(heuristicDetect('sudo apt-get update && sudo apt-get install -y htop')).toBe('shell')
  })

  it('Dockerfile 识别', () => {
    const df = 'FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y curl\nCMD ["/bin/bash"]'
    expect(heuristicDetect(df)).toBe('dockerfile')
  })

  it('JSON 识别', () => {
    expect(heuristicDetect('{\n  "name": "vimpaste",\n  "version": 1\n}')).toBe('json')
  })

  it('PowerShell 识别', () => {
    expect(heuristicDetect('$path = "C:\\tmp"\nGet-ChildItem -Recurse -Path $path')).toBe(
      'powershell',
    )
  })

  it('Python 识别', () => {
    expect(heuristicDetect('import os\n\ndef main():\n    print(os.name)\n')).toBe('python')
  })

  it('SQL 识别', () => {
    expect(heuristicDetect('SELECT id, name FROM users WHERE id = 1;')).toBe('sql')
  })

  it('Nginx 识别', () => {
    const conf = 'server {\n  listen 80;\n  location / {\n    proxy_pass http://backend;\n  }\n}'
    expect(heuristicDetect(conf)).toBe('nginx')
  })

  it('YAML 识别', () => {
    expect(heuristicDetect('---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo')).toBe(
      'yaml',
    )
  })

  it('空文本为 plaintext', () => {
    expect(heuristicDetect('')).toBe('plaintext')
    expect(heuristicDetect('   \n  ')).toBe('plaintext')
  })
})

describe('detectLanguage（含 highlight.js 受限候选）', async () => {
  it('普通文本回落为 plaintext', async () => {
    expect(await detectLanguage('这是一段普通的中文文本，不含代码。')).toBe('plaintext')
    expect(await detectLanguage('The quick brown fox jumps over the lazy dog.')).toBe('plaintext')
  })

  it('JavaScript 识别', async () => {
    const js = 'function add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));'
    expect(await detectLanguage(js)).toBe('javascript')
  })

  it('TypeScript 识别', async () => {
    const ts =
      'interface User {\n  name: string\n}\nconst u: User = { name: "a" }\nconst g = (x: User): string => x.name'
    expect(await detectLanguage(ts)).toBe('typescript')
  })

  it('异步路径与启发式一致（K3s 为 shell）', async () => {
    expect(await detectLanguage(K3S)).toBe('shell')
  })
})

describe('languageLabel', () => {
  it('展示名称完整', () => {
    expect(languageLabel('shell')).toBe('Shell / Bash')
    expect(languageLabel('plaintext')).toBe('纯文本')
  })
})
