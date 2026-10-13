import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import SteamNotice from './SteamNotice'

afterEach(cleanup)

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SteamNotice />
      <Where />
    </MemoryRouter>
  )
}

describe('the message after coming back from Steam', () => {
  it('shows nothing on an ordinary visit', () => {
    renderAt('/')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('confirms a successful connection', () => {
    renderAt('/?steam=linked')
    expect(screen.getByRole('status').textContent).toMatch(/Steam connected/)
  })

  it.each([
    ['invalid', /couldn't confirm your Steam sign-in/],
    ['state', /expired or was already used/],
    ['session', /cookies/],
    ['unavailable', /isn't responding/],
    ['already_linked', /already connected to another BacklogVault account/],
    ['disabled', /isn't set up/],
    ['something-new', /did not work/],
  ])('explains a %s failure', (reason, message) => {
    renderAt(`/?steam=error&reason=${reason}`)
    expect(screen.getByRole('alert').textContent).toMatch(message)
  })

  it('removes the code from the address so a refresh does not repeat it', async () => {
    renderAt('/?steam=error&reason=state&keep=1')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?keep=1'))
    expect(screen.getByRole('alert')).toBeTruthy() // the message stays on screen
  })

  it('can be dismissed', () => {
    renderAt('/?steam=linked')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
