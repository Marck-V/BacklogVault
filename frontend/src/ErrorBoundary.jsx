import { Component } from 'react'

// Without this, an error while rendering any component blanks the whole page. With it, the header and footer stay
// and the broken page shows a message. Changing `resetKey` (for example the URL) clears the error again.
export default class ErrorBoundary extends Component {
  state = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error) {
    return { error }
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <section className="state-page" role="alert">
        <h1>Something went wrong</h1>
        <p>This page hit an unexpected error. Reloading usually fixes it.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </section>
    )
  }
}
