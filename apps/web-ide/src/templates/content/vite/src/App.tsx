import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.tsx';
import About from './pages/About.tsx';
import Todos from './pages/Todos.tsx';
import Success from './pages/Success.tsx';

function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/about" element={<About />} />
    <Route path="/todos" element={<Todos />} />
    <Route path="/success" element={<Success />} />
  </Routes>;
}

export default App;
