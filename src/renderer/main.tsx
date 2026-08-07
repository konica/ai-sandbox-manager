import './theme/app.css'
import './theme/overrides.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LanguageProvider } from './i18n'

// macOS renders traffic-light window buttons at the top-left; tag the root so only macOS
// gets the extra title-bar left padding (see overrides.css). Windows/Linux keep the tight inset.
const uaPlatform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || ''
if (/mac/i.test(uaPlatform)) document.documentElement.classList.add('is-mac')

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
)
