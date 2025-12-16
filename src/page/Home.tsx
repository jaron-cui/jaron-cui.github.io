import { Button } from '@mui/material';
import { BUTTON_STYLE, DEFAULT_FONT, DEFAULT_MARGIN } from '../util/styles';
import { Col, Collapse, Container, Dropdown, Row } from "react-bootstrap";
import { useEffect, useState } from 'react';
import { dateToString, formatDateString } from '../util/util';

const EXPERIENCES: ExperienceProps[] = [
  {
    organization: 'Northeastern University',
    title: 'Teaching Assistant',
    startDate: new Date('2021-1-9'),
    endDate: new Date('2024-1-1'),
    description:
      `I have been a teaching assistant at Northeastern for the majority of my academic career. I have taught, graded,
      and guided students in Fundamentals of Computer Science, Algorithms & Data Structures, and Professional
      Development for Co-op.`
  }, {
    organization: 'Amazon Robotics',
    title: 'Software Development Engineer',
    startDate: new Date('2023-1-9'),
    endDate: new Date('2023-8-13'),
    description: `I worked on the Amazon Robotics Identification (AR-ID) team, where our main objective was
    to build a hardware and software computer vision solution for Amazon's shipping operations.
    This internal product is already in use, automatically identifying and tracking billions of packages flowing through
    distribution centers and warehouses. My role involved the creation and completion of a robust camera calibration process that
    would enable thousands of additional anticipated installations.`
  }, {
    organization: 'PowerAdvocate',
    title: 'Software Developer Co-op',
    startDate: new Date('2022-1-7'),
    endDate: new Date('2022-6-23'),
    description:
      `As my first co-op, I was primarily interested in experiencing as many different environments as possible.
      So, by the end of my tenure, I had been involved in the work of five different development teams.
      This included the migration of databases from OracleDB to PostGreSQL, the development of a programming
      challenge website for hiring interviews, the creation of a new OData 4.0 API, and work on a GraphQL React application.`
  }
]

export default function Home() {
  return (
    <div style={{
      ...DEFAULT_FONT,
      ...DEFAULT_MARGIN
    }}>
      <Container>
        <Row>
          <Col style={{verticalAlign: 'bottom'}}>
            <h1>Jaron Cui</h1>
            <h3>Master's Student at New York University</h3>
            <hr/>
            <p>
              I'm a Northeastern University graduate and NYU Masters student interested in machine learning and robotics. Why?
              Because I love to build things, both physically and in code! Here's what I've been working on lately:
            </p>
          </Col>
          <Col xs={2}>
            <img src='portrait2-square.jpg' alt='Portrait' style={{
              width: '200px', height: '200px', margin: '20px', borderRadius: '50%'
            }}/>
          </Col>
        </Row>
        <Row style={{paddingBottom: '40px'}}>
          <Col>
            <h2>Recent Musings</h2>
            <p>Click the headings below for interactive demos and more info.</p>
            <Row>
              <Col>
                <h4><a href='/#/projects/neural-evolution-v1'>Neural Evo-Devo</a></h4>
                <img src="project/neural-evolution-v1/neural-evolution-specimen.gif" alt="Growing a brain" width='100%'/>
              </Col>
              <Col>
                <h4><a href='/#/projects/robotic-hand'>Robotic Hand</a></h4>
                <img src="robot-hand.gif" alt="Robotic Hand" width='100%'/>
              </Col>
              <Col>
                <h4><a href='https://en.wikipedia.org/wiki/Muscovy_duck'>My Ducks</a></h4>
                <img src="ducks.gif" alt="Rect" width='100%'/>
              </Col>
            </Row>
          </Col>
        </Row>
        {/* <Row>
          <Col>
            <h2>Professional Experience</h2>
            {EXPERIENCES.map(experience => (
              <Experience {...experience}/>
            ))}
          </Col>
        </Row> */}
      </Container>
    </div>
  );
}

interface ExperienceProps {
  organization: string;
  title: string;
  startDate: Date;
  endDate: Date;
  description: string;
}

function Experience({ organization, title, startDate, endDate, description }: ExperienceProps) {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div style={{paddingTop: '5px', paddingBottom: '5px'}}>
      <Button disableRipple={false} onClick={() => setOpen(!open)} sx={{
        ...DEFAULT_FONT,
        ...BUTTON_STYLE,
        color: 'black',
        textAlign: 'left',
        textTransform: 'unset !important',
        width: '100%',
        justifyContent: 'flex-start'
      }}>
        <div style={{display: 'flex', flexDirection: 'row', width: '100%', justifyContent: 'space-between'}}>
          <span><b>{organization}</b> &nbsp;|&nbsp; <i>{title}</i></span>
          <span>{dateToString(startDate)} &nbsp;-&nbsp; {dateToString(endDate)}</span>
        </div>
      </Button>
      <Collapse in={open}>
        <div>{description}</div>
      </Collapse>
    </div>
  )
}