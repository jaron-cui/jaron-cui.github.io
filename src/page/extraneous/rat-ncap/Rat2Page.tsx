/** /#/rat2: the NCAP rat demo drawn with Slender, as flat vector shapes rigged on Slender bones. */
import { App } from './app/App';
import { SlenderRenderer } from './app/slenderRenderer';

export default function Rat2Page() {
  return <App createRenderer={container => new SlenderRenderer(container)} title='NCAP rat (Slender)' />;
}
