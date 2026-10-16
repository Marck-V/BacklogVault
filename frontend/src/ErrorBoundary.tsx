import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  resetKey: unknown
  children: ReactNode
}

interface State {
  error: Error | null
  resetKey: unknown
}

// Without this, an error while rendering any component blanks the whole page. With it, the header and footer stay
// and the broken page shows a message. Changing `resetKey` (for example the URL) clears the error again.
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  override render() {
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
