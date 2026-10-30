// 简易 ZIP 读写工具：导出使用不压缩存储，导入兼容 store 与 deflate-raw
import { AppError } from './errors'

export interface ZipEntryInput {
  path: string
  data: Uint8Array
}

export interface ZipReadLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// CRC32 查表
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let j = 0; j < 8; j++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 校验条目路径：禁止绝对路径、盘符与路径穿越
function assertSafePath(path: string): void {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new AppError('IMPORT_INVALID', `压缩包内路径不合法：${path}`)
  }
}

// 读取外部 ZIP 时统一分隔符（Windows 压缩工具会使用反斜杠）
function normalizeReadPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new AppError('IMPORT_INVALID', `压缩包内路径不合法：${path}`)
  }
  return normalized
}

function dosDateTime(): { time: number; date: number } {
  const now = new Date()
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  return { time, date }
}

// 生成 ZIP（仅 store，不压缩），适合照片等已压缩内容
export function createZip(entries: ZipEntryInput[]): Uint8Array {
  const { time, date } = dosDateTime()
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    assertSafePath(entry.path)
    const nameBytes = encoder.encode(entry.path)
    const crc = crc32(entry.data)

    const local = new Uint8Array(30 + nameBytes.length)
    writeU32(local, 0, 0x04034b50)
    writeU16(local, 4, 20) // version needed
    writeU16(local, 6, 0x0800) // UTF-8 文件名
    writeU16(local, 8, 0) // store
    writeU16(local, 10, time)
    writeU16(local, 12, date)
    writeU32(local, 14, crc)
    writeU32(local, 18, entry.data.length)
    writeU32(local, 22, entry.data.length)
    writeU16(local, 26, nameBytes.length)
    writeU16(local, 28, 0)
    local.set(nameBytes, 30)

    localChunks.push(local, entry.data)

    const central = new Uint8Array(46 + nameBytes.length)
    writeU32(central, 0, 0x02014b50)
    writeU16(central, 4, 20) // version made by
    writeU16(central, 6, 20) // version needed
    writeU16(central, 8, 0x0800)
    writeU16(central, 10, 0)
    writeU16(central, 12, time)
    writeU16(central, 14, date)
    writeU32(central, 16, crc)
    writeU32(central, 20, entry.data.length)
    writeU32(central, 24, entry.data.length)
    writeU16(central, 28, nameBytes.length)
    writeU16(central, 30, 0) // extra
    writeU16(central, 32, 0) // comment
    writeU16(central, 34, 0) // disk
    writeU16(central, 36, 0) // internal attrs
    writeU32(central, 38, 0) // external attrs
    writeU32(central, 42, offset)
    central.set(nameBytes, 46)
    centralChunks.push(central)

    offset += local.length + entry.data.length
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = new Uint8Array(22)
  writeU32(end, 0, 0x06054b50)
  writeU16(end, 4, 0)
  writeU16(end, 6, 0)
  writeU16(end, 8, entries.length)
  writeU16(end, 10, entries.length)
  writeU32(end, 12, centralSize)
  writeU32(end, 16, offset)
  writeU16(end, 20, 0)

  const totalSize = offset + centralSize + end.length
  const output = new Uint8Array(totalSize)
  let cursor = 0
  for (const chunk of localChunks) {
    output.set(chunk, cursor)
    cursor += chunk.length
  }
  for (const chunk of centralChunks) {
    output.set(chunk, cursor)
    cursor += chunk.length
  }
  output.set(end, cursor)
  return output
}

// 解压 ZIP；返回按路径索引的条目数据
export async function readZip(
  bytes: Uint8Array,
  limits: ZipReadLimits,
): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22) {
    throw new AppError('IMPORT_INVALID', '文件不是有效的 ZIP 压缩包')
  }

  const eocdOffset = findEocd(bytes)
  if (eocdOffset < 0) {
    throw new AppError('IMPORT_INVALID', 'ZIP 压缩包结构不完整')
  }

  const entryCount = readU16(bytes, eocdOffset + 10)
  const centralOffset = readU32(bytes, eocdOffset + 16)
  if (entryCount === 0 || entryCount > limits.maxEntries) {
    throw new AppError('IMPORT_INVALID', '压缩包内文件数量超出限制')
  }
  if (centralOffset >= bytes.length) {
    throw new AppError('IMPORT_INVALID', 'ZIP 中央目录位置无效')
  }

  const entries = new Map<string, Uint8Array>()
  let cursor = centralOffset
  let totalBytes = 0

  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > bytes.length || readU32(bytes, cursor) !== 0x02014b50) {
      throw new AppError('IMPORT_INVALID', 'ZIP 中央目录损坏')
    }

    const method = readU16(bytes, cursor + 10)
    const compressedSize = readU32(bytes, cursor + 20)
    const uncompressedSize = readU32(bytes, cursor + 24)
    const nameLength = readU16(bytes, cursor + 28)
    const extraLength = readU16(bytes, cursor + 30)
    const commentLength = readU16(bytes, cursor + 32)
    const localOffset = readU32(bytes, cursor + 42)

    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > bytes.length) {
      throw new AppError('IMPORT_INVALID', 'ZIP 文件名读取失败')
    }
    const path = normalizeReadPath(decoder.decode(bytes.subarray(nameStart, nameEnd)))
    cursor = nameEnd + extraLength + commentLength

    // 目录条目跳过
    if (path.endsWith('/') || path === '') continue

    if (entries.has(path)) {
      throw new AppError('IMPORT_INVALID', `压缩包内存在重复文件：${path}`)
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new AppError('IMPORT_INVALID', `单个文件超过大小限制：${path}`)
    }
    totalBytes += uncompressedSize
    if (totalBytes > limits.maxTotalBytes) {
      throw new AppError('IMPORT_INVALID', '解压后总大小超出限制')
    }

    if (localOffset + 30 > bytes.length || readU32(bytes, localOffset) !== 0x04034b50) {
      throw new AppError('IMPORT_INVALID', `ZIP 文件头损坏：${path}`)
    }
    const localNameLength = readU16(bytes, localOffset + 26)
    const localExtraLength = readU16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) {
      throw new AppError('IMPORT_INVALID', `ZIP 数据区不完整：${path}`)
    }

    const raw = bytes.subarray(dataStart, dataEnd)
    let data: Uint8Array
    if (method === 0) {
      data = raw
    } else if (method === 8) {
      data = await inflateRaw(raw)
    } else {
      throw new AppError('IMPORT_INVALID', `不支持的压缩方式：${method}`)
    }

    if (data.length !== uncompressedSize && uncompressedSize !== 0) {
      throw new AppError('IMPORT_INVALID', `文件解压后大小不一致：${path}`)
    }
    entries.set(path, data)
  }

  return entries
}

function findEocd(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      return i
    }
  }
  return -1
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function readU16(source: Uint8Array, offset: number): number {
  return source[offset] | (source[offset + 1] << 8)
}

function readU32(source: Uint8Array, offset: number): number {
  return (
    source[offset] |
    (source[offset + 1] << 8) |
    (source[offset + 2] << 16) |
    (source[offset + 3] << 24)
  ) >>> 0
}
