function initials(nameOrEmail: string): string {
  const s = nameOrEmail.trim()
  if (!s) return '?'
  const parts = s.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return s.slice(0, 2).toUpperCase()
}

function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 42%)`
}

// Avatar shows the user's image (e.g. their Google picture) when present, and
// otherwise a colored circle with their initials.
export function Avatar({
  image,
  name,
  email,
  size = 56,
}: {
  image: string | null
  name: string
  email: string
  size?: number
}) {
  if (image) {
    return (
      <img
        src={image}
        alt={name || email}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(email || name),
        fontSize: size * 0.4,
      }}
    >
      {initials(name || email)}
    </div>
  )
}
