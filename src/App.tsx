import type { JSX } from 'react';
import './App.css';
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import Home from './page/Home';
import 'bootstrap/dist/css/bootstrap.min.css';
import Navigation from './component/Navigation';
import NotFound from './page/NotFound';

// Every page but Home loads on first visit, so the homepage doesn't download the editors, games, and
// project pages too.
const Projects = lazy(() => import('./page/Projects'));
const ProjectPage = lazy(() => import('./page/extraneous/Project'));
const Experience = lazy(() => import('./page/Experience'));
const Contact = lazy(() => import('./page/Contact'));
const ViewportPage = lazy(() => import('./page/extraneous/ViewportPage'));
const StringUtil = lazy(() => import('./page/extraneous/StringManipulation').then(m => ({ default: m.StringUtil })));
const WordlePage = lazy(() => import('./page/extraneous/Wordle'));
const Tetris = lazy(() => import('./page/extraneous/Tetris'));
const Groc = lazy(() => import('./page/extraneous/Grocery'));
const Rect = lazy(() => import('./page/extraneous/rect/Rect').then(m => ({ default: m.Rect })));
const Chess = lazy(() => import('./page/extraneous/chess/view').then(m => ({ default: m.Chess })));
const ConnectFour = lazy(() => import('./page/extraneous/connect-four/view').then(m => ({ default: m.ConnectFour })));
const Slender = lazy(() => import('./page/extraneous/slender/Slender').then(m => ({ default: m.Slender })));
const Editor = lazy(() => import('./page/extraneous/slender/Editor').then(m => ({ default: m.Editor })));

// Heavy demos load on first visit (three.js, MuJoCo WASM and the model stay out of the main bundle).
const RatPage = lazy(() => import('./page/extraneous/rat-ncap/RatPage'));
const Rat2Page = lazy(() => import('./page/extraneous/rat-ncap/Rat2Page'));
const GraphEd = lazy(() => import('./page/extraneous/graphed/GraphEd'));
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
  ['/#/graphed', () => <GraphEd/>],
  ['/#/gears', () => <GearTool/>],
]

// Full-screen pages that render without the site navigation bar.
const fullScreenPrefixes = ['/#/slender', '/#/rat', '/#/graphed'];

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
