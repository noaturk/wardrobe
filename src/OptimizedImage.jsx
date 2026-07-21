import { forwardRef } from "react";

export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  sizes,
  priority = false,
  loading,
  decoding,
  quality: _quality,
  breakpoints: _breakpoints,
  ...props
}, ref) {
  return <img ref={ref} src={src} alt={alt} sizes={sizes} loading={loading || (priority ? "eager" : "lazy")} decoding={decoding || "async"} {...props} />;
});
