import { Clipboard, Envelope, Github, Icon, Linkedin } from "react-bootstrap-icons";
import { CopyButton } from "../component/Buttons";
import { LINKS } from '../util/links';
import { DEFAULT_FONT, DEFAULT_MARGIN } from "../util/styles";

export default function Contact() {
  return (
    <div style={{
      ...DEFAULT_FONT,
      ...DEFAULT_MARGIN
    }}>
      <h4>Contact</h4>
      <div style={{ marginTop: '20px' }}>
        <Item label='Email' text={LINKS.email} link={`mailto:${LINKS.email}`} Img={Envelope}/>
        <Item label='LinkedIn' text={LINKS.linkedin} Img={Linkedin}/>
        <Item label='GitHub' text={LINKS.github} Img={Github}/>
      </div>
    </div>
  );
}

type ItemProps = {
  label: string;
  text: string;
  link?: string;
  Img: Icon;
}

function Item({ label, text, link, Img }: ItemProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      width: '400px',
      marginBottom: '10px'
    }}>
      <span style={{ marginRight: '20px' }}><Img /> {label}: <a href={link || text}>{text}</a></span>
      <CopyButton text={text}/>
    </div>
  );
}