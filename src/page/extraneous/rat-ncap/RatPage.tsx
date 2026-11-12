/** /#/rat: the NCAP rat demo drawn with three.js. Lazy-loaded, so three.js and MuJoCo stay out of the main bundle. */
import { App } from './app/App';
import { Renderer } from './app/renderer';

export default function RatPage() {
  return <App createRenderer={container => new Renderer(container)} />;
}
