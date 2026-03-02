import { Button } from '@mui/material';
import { BUTTON_STYLE, CENTERED_VERTICAL, DEFAULT_FONT, DEFAULT_MARGIN } from '../util/styles';
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
            <h3>Master's Student and Researcher at New York University</h3>
            <hr/>
            <p>
              I'm researching neural circuit architectural priors at <a href='https://robotics.engineering.nyu.edu/group/grail/'>NYU GRAIL</a>, where we aim to 
              train bio-inspired artifical neural networks for robotic locomotion.
              Previously, I worked on developing AR-ID computer vision units at <a href='https://amazon.jobs/content/en/teams/ftr/amazon-robotics'>Amazon Robotics</a>.
              Now, I strive to push forward at the intersection of robotics and AI.
            </p>
          </Col>
          <Col xs={2}>
            <img src='portrait2-square.jpg' alt='Portrait' style={{
              width: '200px', height: '200px', margin: '20px', borderRadius: '50%'
            }}/>
          </Col>
        </Row>
        <Row>
          <Col>
            <h2>Neural Circuit Architectural Priors</h2>
            <Row>
              <Col>
                <img src="project/ncap/ncap-a1.gif" alt="NCAP controlling a Unitree A1 in MuJoCo simulation" width='100%'/>
              </Col>
              <Col>
                <img src="project/ncap/compliant-a1.gif" alt="Compliant muscle model on the real Unitree A1" width='100%'/>
              </Col>
              <Col>
                <img src="project/ncap/ncap-rat-task-diagram.png" alt="NCAP with rat action/observation space" width='100%'/>
              </Col>
            </Row>
            <p>
              A young chipmunk sprints up a tree and lunges to a branch.
              If you were to pitch it like a baseball, it would uncurl and hit the ground running.
              It does this with an acorn-powered brain the size of an almond.
              Yet, the very best robots cannot ever hope to compare to a month-old rat creature in the woods.
              Small animals demonstrate unbelievably robust and efficient locomotion.
            </p>
            <p>
              At GRAIL, I've been working with PhD candidate <a href='https://www.linkedin.com/in/nikhilxb/'>Nikhil Bhattasali</a> on Neural Circuit Architectural Priors (NCAP).
              Our goal is to build and train spiking neural networks (SNNs) based on the spinal circuits in rodents for use in robotic locomotion.
              The advantage of such SNNs lies in their interpretability and robustness, composed of a few dozen neurons and synapses,
              as opposed to the millions of parameters in deep neural networks.
            </p>
            <p>
              Thus far, we've demonstrated that the neural architecture responsible for enabling rats to walk can be applied to the Unitree A1 quadruped.
              A simulated brainstem command controls the forward target velocity, and adding turning and jumping is our next priority.
              We are also exploring biorealistic muscle simulation as an alternate action space, which adds compliance to our robotic limbs.
            </p>
            <p>
              Our abstract for applying NCAP to a simulated rat embodiment <b><i>Neural Circuit Architectural Priors for Rat Locomotion</i></b> was accepted
              by the <a href='https://www.janelia.org/you-janelia/conferences/simulated-bodies-whole-body-biomechanical-models-0'>Simulated Bodies: Whole Body Biomechanical Models 2026 conference</a>. We will present there this coming April.
              We plan to submit a paper chronicling further progress to <a href='https://blog.neurips.cc/category/2026-conference/'>NeurIPS 2026</a> by May.
            </p>
          </Col>
        </Row>
        <Row style={{paddingBottom: '40px'}}>
          <Col>
            <h2>Recent Doings</h2>
            <Row>
              <Col>
                <h4><a href='/#/projects/marimba'>I Built a Marimba</a></h4>
                <img src="project/marimba/marimba.jpg" alt="Marimba" width='100%'/>
              </Col>
              <Col>
                <h4><a href='/#/projects/cdit-planning'>CDiT World Model</a></h4>
                <img src="project/cdit-planning/obstructed_mujoco_rollout.gif" alt="World model exploration" width='100%'/>
              </Col>
              <Col>
                <h4><a href='/#/projects/robotic-hand'>Robotic Hand</a></h4>
                <img src="robot-hand.gif" alt="Robotic Hand" width='100%'/>
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