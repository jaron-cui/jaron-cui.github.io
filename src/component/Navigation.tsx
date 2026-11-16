import { useState } from 'react';
import { Navbar, Container, Nav, NavDropdown } from 'react-bootstrap';
import { Envelope, EnvelopePaper, Github, Linkedin } from 'react-bootstrap-icons';
import { LINKS } from '../util/links';
import { DEFAULT_FONT } from '../util/styles';
import WidthSwitch from './WidthSwitch';

function Social(props: {link: string, normal: any, hover: any}) {
  const [hovering, setHovering] = useState<boolean>(false);
  
  return (
    <Navbar.Brand
      href={props.link}
      target='_blank'
      rel='noreferrer noopener'
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => setHovering(true)}>
      {hovering ? props.hover : props.normal}
    </Navbar.Brand>
  )
}

function NarrowNavigation({ currentPath }: { currentPath: string }) {
  const sectionNames: {[key in string]: string} = {
    '/': 'Home',
    '/#/projects': 'Projects',
    '/#/experience': 'Experience',
    '/#/contact': 'Contact'
  };

  function Section({ path, current }: { path: string, current: string }) {
    return (
      <NavDropdown.Item key={path} href={path} active={path===current} style={
        path==current ? {backgroundColor: '#707577', width: '100%'} : { width:'100%' }
      }>
        {sectionNames[path]}
      </NavDropdown.Item>
    );
  }

  function Bar() {
    return <div className='vr' style={{backgroundColor: 'white', width: '2px'}}></div>;
  }
  
  return (
    <Navbar bg='dark' variant='dark' style={DEFAULT_FONT}>
      <Container>
        <Navbar.Brand href='/'>Jaron Cui</Navbar.Brand>
        <Nav className='me-auto' style={{width:'150px'}}>
          <Bar />
          <NavDropdown title={sectionNames[currentPath]} style={{width: '100%'}} menuVariant='dark'>
            <Section path='/' current={currentPath}/>
            <Section path='/#/projects' current={currentPath}/>
            <Section path='/#/experience' current={currentPath}/>
            <Section path='/#/contact' current={currentPath}/>
          </NavDropdown>
          <Bar />
        </Nav>
        <Social link={`mailto:${LINKS.email}`}
          normal={<Envelope color='#DDDDDD'/>}
          hover={<EnvelopePaper />}/>
        <Social link={LINKS.linkedin}
          normal={<Linkedin color='#DDDDDD'/>}
          hover={<Linkedin />}/>
        <Social link={LINKS.github}
          normal={<Github color='#DDDDDD'/>}
          hover={<Github />}/>
      </Container>
    </Navbar>
  );
}

function WideNavigation({ currentPath }: { currentPath: string }) {
  function Section({ title, path, current }: { title: string, path: string, current: string }) {
    return <Nav.Link key={title} href={path} active={path===current}>{title}</Nav.Link>
  }

  return (
    <Navbar bg='dark' variant='dark' style={DEFAULT_FONT}>
      <Container>
        <Navbar.Brand href='/'>Jaron Cui</Navbar.Brand>
        <Nav className='me-auto'>
          <Section title='Home' path='/' current={currentPath}/>
          <Section title='Projects' path='/#/projects' current={currentPath}/>
          <Section title='Experience' path='/#/experience' current={currentPath}/>
          <Section title='Contact' path='/#/contact' current={currentPath}/>
        </Nav>
        <Social link={`mailto:${LINKS.email}`}
          normal={<Envelope color='#DDDDDD'/>}
          hover={<EnvelopePaper />}/>
        <Social link={LINKS.linkedin}
          normal={<Linkedin color='#DDDDDD'/>}
          hover={<Linkedin />}/>
        <Social link={LINKS.github}
          normal={<Github color='#DDDDDD'/>}
          hover={<Github />}/>
      </Container>
    </Navbar>
  );
}

export default function Navigation(props: { currentPath: string }) {
  return <WidthSwitch>
    <WideNavigation {...props}/>
    <NarrowNavigation {...props}/>
  </WidthSwitch>
}