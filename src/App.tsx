import type { JSX } from 'react';
import './App.css';
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import Home from './page/Home';
import 'bootstrap/dist/css/bootstrap.min.css';
import Navigation from './component/Navigation';
import Projects from './page/Projects';
import ProjectPage from './page/extraneous/Project';
import Experience from './page/Experience';
import NotFound from './page/NotFound';
import Contact from './page/Contact';
import ViewportPage from './page/extraneous/ViewportPage';
import { StringUtil } from './page/extraneous/StringManipulation';
import WordlePage from './page/extraneous/Wordle';
import Tetris from './page/extraneous/Tetris';
import Groc from './page/extraneous/Grocery';
import { Rect } from './page/extraneous/rect/Rect';
import { Chess } from './page/extraneous/chess/view';
import { ConnectFour } from './page/extraneous/connect-four/view';
import { Slender } from './page/extraneous/slender/Slender';
import { Editor } from './page/extraneous/slender/Editor';

// Heavy demos load on first visit (three.js, MuJoCo WASM and the model stay out of the main bundle).
const RatPage = lazy(() => import('./page/extraneous/rat-ncap/RatPage'));
const Rat2Page = lazy(() => import('./page/extraneous/rat-ncap/Rat2Page'));
const GearTool = lazy(() => import('./page/extraneous/gears/GearTool'));

const paths = [
  ['/', () => <Home />],
  ['/#/projects', () => <Projects />],
  ['/#/projects\\?search={}', ([ search ]: string[]) => <Projects initialSearch={search}/>],
  ['/#/projects/{}', ([ project ]: string[]) => <ProjectPage project={project}/>],
  ['/#/experience', () => <Experience />],
  ['/#/contact', () => <Contact />],
  ['/#/3DViewport', () => <ViewportPage />],
  ['/#/strings', () => <StringUtil />],
  ['/#/wordle', () => <WordlePage />],
  ['/#/wordle/{}', ([ cipher ]: string[]) => <WordlePage cipherText={cipher}/>],
  ['/#/tetris', () => <Tetris />],
  ['/#/screen', () => <Groc />],
  ['/#/rect', () => <Rect />],
  ['/#/chess', () => <Chess/>],
  ['/#/connect-four', () => <ConnectFour/>],
  ['/#/slender', () => <Editor/>],
  ['/#/slender/demo', () => <Slender/>],
  ['/#/rat', () => <RatPage/>],
  ['/#/rat2', () => <Rat2Page/>],
  ['/#/gears', () => <GearTool/>],
]

// Full-screen pages that render without the site navigation bar.
const fullScreenPrefixes = ['/#/slender', '/#/rat'];

function App() {
  const { pathname, hash } = useLocation();
  const currentPath = pathname + hash;

  function getPage() {
    for (const [p, r] of paths) {
      const path = new RegExp(`^${(p as string).replaceAll('{}', '(.*)')}$`);
      const result = r as (parameters: string[]) => JSX.Element;
      if (path.test(currentPath)) {
        return result(currentPath.match(path)?.slice(1) || []);
      }
    }

    return <NotFound message='Sorry, could not find that page!'/>;
  }

  return (
    <>
      {!fullScreenPrefixes.some(prefix => currentPath.startsWith(prefix)) && <Navigation currentPath={currentPath}/>}
      <div>
        <Suspense fallback={null}>{getPage()}</Suspense>
      </div>
    </>
  );
}

export default App;
