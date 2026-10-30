import { useState } from 'react'

interface LazyImageProps {
  src: string
  alt?: string
  // 外层容器样式（控制宽高比）
  wrapperClassName?: string
  imgClassName?: string
}

// 懒加载图片：加载完成前显示柔和底色，完成后淡入
export default function LazyImage({ src, alt = '', wrapperClassName = '', imgClassName = '' }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className={`lazy-image${loaded ? ' is-loaded' : ''} ${wrapperClassName}`.trim()}>
      <img
        src={src}
        alt={alt}
        className={imgClassName}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
