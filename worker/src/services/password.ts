// 密码哈希与强度校验
// 采用 PBKDF2-HMAC-SHA256（WebCrypto 原生支持），并记录算法/迭代次数/盐值版本，便于未来升级。
// 不使用明文/MD5/SHA-1/裸 SHA-256。

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BITS = 256
const SCHEME = 'pbkdf2-sha256'

// 生成密码哈希，格式：pbkdf2-sha256$迭代次数$盐值$派生值（均为 base64）
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const derived = await deriveBits(password, salt, PBKDF2_ITERATIONS)
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`
}

// 校验密码
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    return false
  }
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false
  }
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(parts[2])
    expected = fromBase64(parts[3])
  } catch {
    return false
  }
  const actual = await deriveBits(password, salt, iterations)
  return constantTimeEqual(actual, expected)
}

// 校验密码强度；通过返回 null，否则返回错误信息
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return '密码至少需要 8 个字符'
  }
  if (password.length > 128) {
    return '密码长度不能超过 128 个字符'
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密码需同时包含字母和数字'
  }
  return null
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
