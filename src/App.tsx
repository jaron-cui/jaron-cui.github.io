import './App.css';
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
  ['/#/slender/demo', () => <Slender/>]
]

// Full-screen pages that render without the site navigation bar.
const fullScreenPrefixes = ['/#/slender'];

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
        {getPage()}
      </div>
    </>
  );
}

export default App;
