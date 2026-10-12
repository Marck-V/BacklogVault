import { Link } from 'react-router-dom'
import { usePageTitle } from './usePageTitle'

export default function NotFound() {
  usePageTitle('Page not found')

  return (
    <section className="state-page">
      <h1>Page not found</h1>
      <p>That page does not exist, or the list may have been deleted.</p>
      <Link to="/" className="state-page-link">
        Back to your lists
      </Link>
    </section>
  )
}
