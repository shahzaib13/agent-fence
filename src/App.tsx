import { BrowserRouter, Route, Routes } from 'react-router'
import { Home } from './pages/Home'
import { QuoteDetail } from './pages/QuoteDetail'
import { Quotes } from './pages/Quotes'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<Home />} />
        <Route path="quotes" element={<Quotes />} />
        <Route path="quotes/:sessionId" element={<QuoteDetail />} />
        {/* Same session, opened on its conversation instead of its result. */}
        <Route path="quotes/:sessionId/chat" element={<QuoteDetail view="chat" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
