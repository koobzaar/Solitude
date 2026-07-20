export type IconName = 'arrow-left' | 'arrow-right' | 'check' | 'close' | 'delete' | 'edit' | 'heart' | 'plus' | 'undo' | 'warning'

interface IconProps {
  name: IconName
  size?: 'small' | 'medium' | 'large'
  label?: string
  className?: string
}

const paths: Record<IconName, React.ReactNode> = {
  'arrow-left': <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  delete: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m6.5 7 .8 13h9.4l.8-13" /><path d="M10 11v5M14 11v5" /></>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  undo: <><path d="m9 7-5 5 5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></>,
  warning: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></>,
}

export function Icon({ name, size = 'medium', label, className = '' }: IconProps) {
  return (
    <svg
      className={`icon icon--${size} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
