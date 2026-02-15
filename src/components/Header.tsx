import { Link } from '@tanstack/react-router'
import { PlusCircle } from 'lucide-react'
import PosterModeToggle from './PosterModeToggle'

export default function Header() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand-link">
          <span className="brand-mark" aria-hidden>
            <img src="/favicon.svg" alt="" />
          </span>
          <span className="brand-copy">
            <strong>QikPoll</strong>
            <small>Anonymous polls that just work</small>
          </span>
        </Link>

        <div className="topbar-actions">
          <Link to="/" className="quick-link">
            <PlusCircle size={16} /> New poll
          </Link>
          <PosterModeToggle />
        </div>
      </div>
    </header>
  )
}
