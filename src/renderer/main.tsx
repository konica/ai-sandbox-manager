import './theme/app.css'
import './theme/overrides.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LanguageProvider } from './i18n'

createRoot(document.getElementById('root')!).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
)
