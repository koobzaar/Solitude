import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('Icon', () => {
  it('supports labeled status icons and hides button decoration', () => {
    const { container } = render(
      <>
        <Icon name="check" size="large" label="Valid line" />
        <Icon name="heart" label="Liked" />
        <button type="button" aria-label="Edit collection"><Icon name="edit" size="small" /></button>
      </>,
    )

    const status = screen.getByRole('img', { name: 'Valid line' })
    expect(status).toHaveAttribute('viewBox', '0 0 24 24')
    expect(status).toHaveAttribute('stroke', 'currentColor')
    expect(screen.getByRole('img', { name: 'Liked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit collection' })).toHaveAccessibleName('Edit collection')
    expect(container.querySelector('button svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
