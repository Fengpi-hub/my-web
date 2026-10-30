// 图片格式识别与尺寸解析（不依赖浏览器解码，仅做结构校验）
export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif'

export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024 // 10MB
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024 // 2MB
const MAX_DIMENSION = 12000
const MAX_PIXELS = 40_000_000

const MIME_BY_TYPE: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

export const ALLOWED_ORIGINAL_MIME = new Set(Object.values(MIME_BY_TYPE))
// 缩略图只接受静态格式，避免动图缩略图
export const ALLOWED_THUMBNAIL_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function mimeForType(type: ImageType): string {
  return MIME_BY_TYPE[type]
}

// 根据文件头魔数判断真实图片类型
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }
  // GIF: GIF87a / GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif'
  }
  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return null
}

// 解析图片宽高；无法解析时返回 null
export function readImageDimensions(
  bytes: Uint8Array,
  type: ImageType,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (type) {
    case 'png':
      return readPngSize(view)
    case 'gif':
      return readGifSize(view)
    case 'webp':
      return readWebpSize(view)
    case 'jpeg':
      return readJpegSize(view)
    default:
      return null
  }
}

// 校验尺寸是否在安全范围内
export function validateDimensions(size: { width: number; height: number }): boolean {
  if (size.width <= 0 || size.height <= 0) return false
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) return false
  return size.width * size.height <= MAX_PIXELS
}

function readPngSize(view: DataView): { width: number; height: number } | null {
  if (view.byteLength < 24) return null
  if (view.getUint32(12) !== 0x49484452) return null // 'IHDR'
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  }
}

function readGifSize(view: DataView): { width: number; height: number } | null {
  if (view.byteLength < 10) return null
  return {
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
  }
}

function readWebpSize(view: DataView): { width: number; height: number } | null {
  if (view.byteLength < 30) return null
  const chunk = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  )

  if (chunk === 'VP8 ') {
    // 有损：起始码 0x9d 0x01 0x2a 后紧跟 16 位宽高（低 14 位有效）
    const offset = 26
    if (view.byteLength < offset + 4) return null
    return {
      width: view.getUint16(offset, true) & 0x3fff,
      height: view.getUint16(offset + 2, true) & 0x3fff,
    }
  }
  if (chunk === 'VP8L') {
    // 无损：21 字节处 14 位宽高
    if (view.byteLength < 25) return null
    const bits = view.getUint32(21, true)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }
  if (chunk === 'VP8X') {
    // 扩展：24 位宽高
    if (view.byteLength < 30) return null
    return {
      width: 1 + readUint24(view, 24),
      height: 1 + readUint24(view, 27),
    }
  }
  return null
}

function readJpegSize(view: DataView): { width: number; height: number } | null {
  let offset = 2
  const length = view.byteLength
  while (offset < length) {
    // 跳过填充字节
    while (offset < length && view.getUint8(offset) === 0xff) offset++
    if (offset >= length) return null
    const marker = view.getUint8(offset)
    offset++

    // 无长度字段的标记
    if (marker === 0xd8 || marker === 0xd9) continue
    if (marker < 0xc0 || marker > 0xfe) continue
    if (offset + 2 > length) return null

    const segmentLength = view.getUint16(offset, false)
    if (segmentLength < 2) return null

    // SOF0-SOF15（排除 DHT/JPG/DAC）
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSof) {
      if (offset + 7 > length) return null
      return {
        height: view.getUint16(offset + 3, false),
        width: view.getUint16(offset + 5, false),
      }
    }
    offset += segmentLength
  }
  return null
}

function readUint24(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) * 0x10000 +
    view.getUint8(offset + 1) * 0x100 +
    view.getUint8(offset + 2)
  )
}
