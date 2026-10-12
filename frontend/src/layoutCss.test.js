import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// jsdom does not lay anything out, so these cannot measure a real page. They guard the specific rules that stop the
// page growing wider than a phone screen, which were verified in a real browser, against being deleted by accident.
// Tests run from the frontend folder, locally and in CI.
const css = readFileSync(join(process.cwd(), 'src', 'App.css'), 'utf8')

// The body of the first rule whose selector is exactly `selector` (outside media queries).
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `a rule for ${selector}`).toBeTruthy()
  return match[1]
}

describe('what keeps the page inside the screen width', () => {
  it('pins the page to the screen width instead of letting it size itself to its widest content', () => {
    const app = rule('.app')
    expect(app).toMatch(/\bwidth:\s*100%/)
    expect(app).toMatch(/max-width:\s*1040px/)
  })

  it('breaks very long unbroken words instead of letting them push the page wider', () => {
    expect(rule('.app')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('lets text boxes shrink inside their row, so a form fits a narrow screen', () => {
    expect(rule('input,\ntextarea')).toMatch(/min-width:\s*0/)
  })

  it('lets the toolbar wrap its controls below the heading', () => {
    expect(rule('.list-toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('lets a list row shrink its name', () => {
    expect(rule('.game-row-name')).toMatch(/min-width:\s*0/)
  })

  it('wraps list rows and stacks their buttons on small screens', () => {
    const media = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}\n/.exec(css)
    expect(media, 'a max-width: 480px media query').toBeTruthy()
    expect(media[1]).toMatch(/\.game-row\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(media[1]).toMatch(/\.game-row-actions\s*\{[^}]*flex:\s*1 1 100%/)
  })
})
