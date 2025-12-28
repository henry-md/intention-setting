import './App.css'
import Popup from './pages/Popup'

/**
 * Root component of the extension. Renders Popup.tsx which handles all routing.
 * No children besides Popup. Parent to none (top-level entry point).
 */
function App() {
  return <Popup />
}

export default App
