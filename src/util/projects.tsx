import { Carousel, Col, Row } from 'react-bootstrap';
import { Chess } from '../page/extraneous/chess/view';
import { Rect } from '../page/extraneous/rect/Rect';
import { NewProjectInfo } from './types';
import { wrapContent } from './util';
import WidthSwitch from '../component/WidthSwitch';
import Clip from '../Clip';
import ProjectEntryGallery from '../component/ProjectEntryGallery';
import Marimba from '../page/extraneous/Marimba';

function YouTubeEmbed({ videoID }: { videoID: string }) {
  return (
    <iframe width='100%' height='480px' src={`https://youtube.com/embed/${videoID}?autoplay=1&showinfo=0&loop=1&rel=0`}></iframe>
  )
}

export const NEW_PROJECTS: NewProjectInfo[] = [
  {
    legacy: false,
    id: 'marimba',
    title: 'Marimba',
    date: '2026-01-12',
    status: 'COMPLETED',
    technologies: ['Woodwork', 'Music', 'Chiseling'],
    page: Marimba
  }, 
  {
    legacy: false,
    id: 'cdit-planning',
    repository: 'https://github.com/jaron-cui/nwm-planning',
    title: 'Planning with World Models',
    date: '2025-12-02',
    status: 'COMPLETED',
    technologies: ['Python', 'PyTorch', 'Conditional Diffusion Transformer', 'Variational Autoencoder'],
    page: fullpage => {
      return (
        <div>
          <h4>Summary</h4>
          <p>
            I train a CDiT-based world model on a topographical navigation environment and demonstrate that it
            can be used for action planning via probing with stochastically sampled actions. We effectively explore
            the terrain virtually. This may be useful in applications where we must do zero-shot planning on novel terrain.
          </p>
          <h4>Motivation</h4>
          <p>
            My Computer Vision class, taught by Saining Xie, had a guest speaker YuTong Bai. Her recent
            work, <i>Whole-Body Conditioned Egocentric Video Prediction</i>, trained an autoregressive
            Conditional Diffusion Transformer (CDiT) on egocentric human video with pose data to serve as a World
            model capable of predicting future visual states given past states and human pose actions.
            In essence, the CDiT developed an understanding of the visual dynamics of human motion without any
            explicit labeling of objects in the world.
          </p>
          <p>
            World models seem to be a tentatively useful tool. On one hand, the perfect world model captures dynamics
            to the point that it is essentially a hyperrealistic simulation. A hyperrealistic simulation would be
            immensely useful for robotics applications. The most common training paradigm for robotics is domain-specific
            data collection. This is expensive and generally nongeneralizable! Every new task we want to train a robot on
            requires a whole new set of data collection for that task. But a performant and accurate simulation that
            captures <i>general</i> dynamics theoretically encodes the information needed for any physical task.
            AI world models also have the advantage over simulations in that they will continuously get better with
            additional training data, whereas simulations need to be manually extended and improved.
            Of course, it is easier said than done to train a good world model.
          </p>
          <p>
            I became interested in seeing whether I could use world models to perform zero-shot planning on robotics tasks.
            I settled on navigation and manipulation as target domains of robotics.
          </p>
          <h4>Implementation</h4>
          <p>
            In Bai's original paper, the environment consisted of egocentric navigation in the real world.
            One observation I have regarding world models is that you can either use more informative state data or
            have a more powerful model. Egocentric navigation uses a relatively uninformative observation
            (just a single first person view) and a very powerful world model (capable of extrapolating entire 3D scenes from
            single first person views).
            I decided to build a simpler environment from scratch to accommodate my sparser computational resources.
            I would use simpler dynamics with a more informative observation to cut down on uncertainty.
            The environment I settled on is a top-down topographic view of procedurally generated mountainous terrain,
            centered on the position of the actor.
            Actions are XY displacements of the actor, which can be obstructed by impassable terrain above a certain altitude.
          </p>
          <div style={{paddingBottom: '40px'}}>
            {wrapContent(<Clip link='https://drive.google.com/file/d/1GAiFphsIMMTBZVtHWaG9WQcH3iZXq-ab/preview'/>)}
          </div>
          <p>
            We can use this model for planning by algorithmically probing it with stochastically-sampled actions.
            The resulting directed acyclic graph grows until the desired end state is found.
            This means that our probing algorithm and world model can produce a sequence of actions to move from a
            starting state to a goal state, where the only inputs are an image of the start state and an image
            of the goal state. Isn't that amazing? The world model can simulate the dynamics of the world without
            really "knowing" what it's simulating. It has no conception of mountains; it has simply learned that high
            topographic values indicate impassability. We determine goal proximity with a distance function trained to
            predict the navigational distance between two images.
          </p>
          <h4>Results</h4>
          <p>
            The trained CDiT has captured the dynamics of the environment accurately enough that planned trajectories
            work when deployed in the real environment. Below, we have an example of a start and goal image pair with
            an obstacle between them.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='30%' src='project/cdit-planning/obstruction-navigation.png'/>)}
              {wrapContent(<img width='100%' src='project/cdit-planning/obstruction-navigation.png'/>)}
            </WidthSwitch>
          </div>
          <p>
            The algorithm is able compose a sequence of stochastically sampled actions that the world model believes
            reaches the goal state. Below, we have the expected trajectory decoded with the VAE from the CDiT latents
            (this video is entirely CDiT output!), and then the trajectory produced by rolling out the action sequence
            in simulation.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(
                <>
                  <img width='15%' src='project/cdit-planning/obstructed_planned_trajectory.gif'/>
                  <img width='15%' src='project/cdit-planning/obstructed_mujoco_rollout.gif'/>
                </>
              )}
              {wrapContent(
                <>
                  <img width='100%' src='project/cdit-planning/obstructed_planned_trajectory.gif'/>
                  <img width='100%' src='project/cdit-planning/obstructed_mujoco_rollout.gif'/>
                </>
              )}
            </WidthSwitch>
          </div>
          <p>
            Here, we have a longer-form zero-shot trajectory planning example where the algorithm is given a sparse
            demonstration of the desired path. The algorithm plans the actions between each consecutive pair of snapshots
            and produces a sequence of actions that successfully reproduce the path in simulation.
          </p>
          <div style={{paddingBottom: '40px'}}>
            {wrapContent(<Clip link='https://drive.google.com/file/d/1wcE78WWiQbHiQ5uxpbOBsvp_Xs2_y_Bb/preview' width='320' height='320'/>)}
            {wrapContent(<Clip link='https://drive.google.com/file/d/1p31Emkaj0W9u8ygOV_QpUWbFPzzRHuVK/preview' width='320' height='320'/>)}
          </div>
          <p>
            The most striking feature about extended world model exploration is how self-consistent the predicted world is.
            When rolling out a random walk of 200 actions in this world model, the shapes of the terrain look very close
            to the initial shapes. I suppose that one strength of diffusion models is that they are explicitly trained
            to refine structure from noise, making them considerably robust to accumulated error. Normally, an input passed
            through a recurrent model 200 times would end with a great deal of error.
          </p>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'neural-evolution-v1',
    repository: 'https://github.com/jaron-cui/neural-evolution',
    title: 'Evolution of Biorealistic Neural Development',
    date: '2025-04-16',
    status: 'COMPLETED',
    technologies: ['Python', 'PyTorch', 'MLP'],
    page: fullpage => {
      return (
        <div>
          <h4>Summary</h4>
          <p>
            I attempt to build biorealistic neural networks composed of highly parameterized neurons with latent states
            and genetically-defined behavioral projections meant to enable the nuanced chemical behaviors of real neurons
            to be emulated. Specimens start from a single neuron and undergo self-regulated mitosis.
            After 70 generations of evolutionary selection from mutated populations, I find that the neural population can
            reach a stable size. I have not tried to evolve useful firing behavior because since my last work on the project,
            I've learned more about neuroscience and have concluded that there are too many shortcomings with this model.
            I plan to build a revised version. The main flaws are that:
            <ol>
              <li>
                This simulation uses binary firing states, when a rate-coded firing state would have superior
                representational capacity.
              </li>
              <li>
                The quadratic growth of inter-neuron connection calculations is incredibly inefficient.
                The version 2 of this project will seek to impose structural constraints that make connection checking
                significantly sparser.
              </li>
            </ol>
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/neural-evolution-v1/neural-evolution-specimen.gif'/>)}
              {wrapContent(<img width='100%' src='project/neural-evolution-v1/neural-evolution-specimen.gif'/>)}
            </WidthSwitch>
          </div>
          <h4>Motivation</h4>
          <p>
            What we call "neural networks" are, in my opinion, only <i>very</i> loosely based on how real
            neural networks work. Consider a sequence of fully-connected layers interspaced with ReLU activations.
            The main biologically-inspired components here are the activation functions and integration of inputs.
            The activation function is based on action potentials, and the integration emulate the excitatory
            and inhibitory signals from other neurons.
          </p>
          <p>
            However, real neurons aren't arranged in neat layers, they don't behave like stateless, timeless functions,
            and their connections aren't static. A real neural network brings to mind an interwoven web of connections
            where timing matters and occasional rewiring encodes information. Inscrutable chemical interactions and signals
            influence the network. And most dramatically, the entire network started as a handful of cells undergoing
            mitosis.
          </p>
          <p>
            I want to try and simulate a biorealistic neural network that starts as one cell and recursively divides
            to grow into a cloud of neurons. I want these neurons to have action potentials, be able to initiate mitosis
            or apoptosis based on external and internal factors, and communicate complex chemical messages to one another.
          </p>
          <h4>Neuron Parameters</h4>
          <p>
            The basic neural unit needs a considerable set of parameters to exhibit the desired behaviors.
            Here is a diagram summarizing the parameters that I have settled on for this project.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/neural-evolution-v1/data-representation.png'/>)}
              {wrapContent(<img width='100%' src='project/neural-evolution-v1/data-representation.png'/>)}
            </WidthSwitch>
          </div>
          <h4>Genome</h4>
          <p>
            I mentioned before that I want to allow complex evolving and reactive cell behaviors that emulate
            the nuanced chemical interactions of real neurons. The way I accomplish this is by evolving the
            functional parameters and hidden state of each neuron with a set of MLPs whose weights I designate
            as part of the genome. For example, there is a parameter derivation MLP that projects the internal
            and external state of a neuron into its activation threshold, signal strength, and hormone
            emission for the current simulation tick. This allows the neuron to rewire itself in response
            to various factors. There is the passive update MLP that evolves the hidden state each tick,
            the active update MLP that evolves the hidden state upon firing, and then there are the MLPs
            that output the connection strength between any two neurons and determine the hidden state of
            daughter cells upon mitosis. This system of genetically-defined projections from state to
            behavior is intended to allow for complex dynamics akin to those in real biology to develop.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/neural-evolution-v1/genome.png'/>)}
              {wrapContent(<img width='100%' src='project/neural-evolution-v1/genome.png'/>)}
            </WidthSwitch>
          </div>
          <h4>Simulation Loop</h4>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/neural-evolution-v1/code.png'/>)}
              {wrapContent(<img width='100%' src='project/neural-evolution-v1/code.png'/>)}
            </WidthSwitch>
          </div>
          <h4>Visualization</h4>
          <p>
            After 70 generations of population-based evolution selecting for specimens that have a neuron
            count closest to 200 and minimize neuron death, we see that one of the surviving members displays
            stable waves of cell division. The neurons undergo mitosis until the population is approximately
            200, at which point they cease. We can see variable strength connections forming, but there is no
            evolutionary pressure related to signal patterns in this case.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/neural-evolution-v1/neural-evolution-specimen.gif'/>)}
              {wrapContent(<img width='100%' src='project/neural-evolution-v1/neural-evolution-specimen.gif'/>)}
            </WidthSwitch>
          </div>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'rums-composition',
    title: 'Robot Utility Models Policy Composition',
    date: '2025-05-02',
    status: 'COMPLETED',
    technologies: ['Python', 'Vector-Quantized Behavior Transformer', 'Robotics', 'Stretch'],
    page: fullpage => {
      return (
        <div>
          <h4>Description</h4>
          <p>
            <i>Robot Utility Models</i> (RUMs) is a framework for training two-finger gripper manipulation policies with
            behavior cloning
            for the <i>hello robot</i> Stretch 3. The framework includes a hand-operated gripper tool for collecting
            demonstrations. The gripper tool is mounted with an iPhone that tracks odometry and camera feed data
            that can be transformed into positional and visual information matching that sensed from the robot's
            perspective. Data can be collected quickly by human operators with cheap equipment, instead of through
            teleoperation. We aim to augment the capabilities of the RUMs framework by implementing the composition
            of more granular policies.
          </p>
          <h4>Trained Policies</h4>
          <p>
            We first select tasks to compose.
            <ol>
              <li>Picking up a lemon or lime.</li>
              <li>Sorting a grasped lemon or lime to a left or right bowl, respectively.</li>
            </ol>
            These policies should be deployed in sequence automatically based on the visual context.
            The sorting task serves the additional purpose of explicitly testing RUMs' handling of multi-modal tasks.
            In order to determine which policy should be deployed at what time, we have two strategic options:
            <ol>
              <li>
                Compare the camera's current view to the aggregated visual embeddings of the start frames of policies.
              </li>
              <li>
                Query a VLM for agentic decision-making.
              </li>
            </ol>
            The composition of the pickup and sorting tasks appears as follows:
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/rums-composition/sort-lemon-rollout.gif'/>)}
              {wrapContent(<img width='100%' src='project/rums-composition/sort-lemon-rollout.gif'/>)}
            </WidthSwitch>
          </div>
          <p>
            We trained these two policies on ~2000 demonstrations we collected in dozens of different environments.
            Descriptions of all demonstrations taken are included in
            this <a href='https://docs.google.com/document/d/1_k5rXlnYaIyyZ88u09NWMHRH34gcvnUyQs-CzBLu2FE/edit?usp=sharing'>
              Task Data Descriptions
            </a> document.
          </p>
          <p>
            We also tried a variant of the sorting task where lemons and limes were not necessary sorted left and right,
            but into a bowl with a physical label the color of the fruit. To reduce the data collection overhead,
            I 3D-printed the labels with ARUCO fiducial patterns with the intent to double our effective sample size
            in post-processing. I created one version of a given sample with the target bowl labeled yellow, and another
            version where the lemon was color-shifted green and the target bowl labeled green.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(
                <>
                  <img width='30%' src='project/rums-composition/fiducial-raw.gif'/>
                  <img width='30%' src='project/rums-composition/fiducial-lemon.gif'/>
                  <img width='30%' src='project/rums-composition/fiducial-lime.gif'/>
                </>
              )}
              <>
                {wrapContent(<img width='100%' src='project/rums-composition/fiducial-raw.gif'/>)}
                {wrapContent(<img width='100%' src='project/rums-composition/fiducial-lemon.gif'/>)}
                {wrapContent(<img width='100%' src='project/rums-composition/fiducial-lime.gif'/>)}
              </>
            </WidthSwitch>
          </div>
          <h4>Alignment</h4>
          <p>
            Finally, I implemented an automatic pre-deployment alignment function that works by searching
            the surroundings for the view angle that looks most like a target image.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='50%' src='project/rums-composition/rums-alignment.gif'/>)}
              {wrapContent(<img width='100%' src='project/rums-composition/rums-alignment'/>)}
            </WidthSwitch>
          </div>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'programmatic-midi',
    repository: 'https://github.com/jaron-cui/midi-generator',
    title: 'Programmatic MIDI Generator',
    date: '2024-10-03',
    status: 'COMPLETED',
    technologies: ['Python', 'MIDI', 'PyTorch', 'Transformer', 'REMI'],
    page: fullpage => {
      return (
        <div>
          <h4>Samples</h4>
          <p>
            A couple of interesting outputs from the algorithm:
          </p>
          <h6>Bright groove:</h6>
          <audio controls src='project/programmatic-midi/bright_hectic.mp3'>Audio not supported by browser</audio>
          <h6>Down in the caves (my favorite):</h6>
          <audio controls src='project/programmatic-midi/down_in_the_caves.mp3'>Audio not supported by browser</audio>
          <h6>Chicken coop chase:</h6>
          <audio controls src='project/programmatic-midi/chicken_coop_chase.mp3'>Audio not supported by browser</audio>
          <h6>The passing eons:</h6>
          <audio controls src='project/programmatic-midi/calm_inquisitive.mp3'>Audio not supported by browser</audio>

          <h4>Description</h4>
          <p>
            Music, as any art, comes from the heart.
          </p>
          <p>
            But my calling as a computer scientist in 2024 compels me to automate away
            human artisans with cold, unfeeling machines. My ultimate objective is to exacerbate wealth inequality
            as large employment sectors of middle-income workers are replaced by a smaller class of higher-paid engineers.
          </p>
          <p>
            Anyway, I thought it would be interesting to try my hand at generating piano music completely programmatically.
            Music is composed at a human's discretion. Great music is often described as closely following music theory
            rules, but breaking them a few times to bring out exceptional sound. Well... I think that musicians should just
            analyze those rule breaks and figure out the pattern so they can be added to the book of music theory.
          </p>
          <p>
            The point is that most music follows well-known patterns. Surprisingly, there don't seem to be many
            easily accessible and good attempts at making programmatic music generators online. I would have thought someone
            would have done it in the 1980s or something.
          </p>
          <h4>Properties of Good Music</h4>
          <p>
            I've written a concise list of general properties of good-sounding music.
            <ol>
              <li>Harmonic consistency - adherence to a musical key, chord progressions, and the emphasis of chord notes.</li>
              <li>Temporal consistency - inertia in changes of pitch or rhythm (scales and arpeggios versus random notes in the key).</li>
              <li>Music Motifs - controlled repetition of ideas, borrowing of low-level musical structures.</li>
              <li>Broad structure - distinct sections combined and modified to form a piece (like rhyme schemes, sections may be repeated. e.g. ABACA)/</li>
            </ol>
          </p>
          <h4>Incorporating Music Theory Algorithmically</h4>
          <p>
            <ul>
              <li>Top left: starting out with a single generic block</li>
              <li>Top right: recursively subdividing the block</li>
              <li>Bottom left: filling in concrete melodies and rhythms</li>
              <li>Bottom right: borrowing from the pool of existing concrete melodies and rhythms</li>
            </ul>
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='80%' src='project/programmatic-midi/iterative-process.png'/>)}
              {wrapContent(<img width='100%' src='project/programmatic-midi/iterative-process.png'/>)}
            </WidthSwitch>
          </div>
          <p>
            In summary, music is structured at several different scales and is defined by regular patterns.
            One crucial observation about music is that phrases can be broken up into smaller units, and those units
            are often interchangeable with similar alternatives. A useful simplification we derive from this
            observation is the representation of a given length of music as simply a (start_note, end_note, duration, chord_progression)
            unit. The most important notes in a given isolated musical chunk are the first and last note.
            We can recursively break this chunk into subchunks specified similarly, until we get to the scale of a few notes per chunk.
            Therefore, when generating a new piece, we first select the high-level details, such as the average tempo, chord progressions,
            and key. Then, we can perform the recursive subdivision process and build detail top-down.
          </p>
          <p>
            In order to maintain harmonic and temporal consistency, we fill in the chunks between start and end notes with
            a graph search. The nodes of the graph are notes, and the edges are the intervals between consecutive notes.
            It is simple to apply constraints to satisfy the aforementioned consistencies. We simply cull all nodes that
            don't match the chord progression at a given time, and cull all edges that break interval rules.
            Then, a probabilistic graph search is an elegant solution.
          </p>
          <p>
            As we fill in blocks, we end up with concrete melodies and rhythms. To satisfy the idea of motifs, we can play a clever
            trick where future block fills start looking at the pool of previously generated patterns and preferentially borrow
            compatible rhythms and melodies.
          </p>
          <p>
            Finally, broad rearrangement can give us familiar section patterns. After doing some research, I've compiled a list
            of common section patterns that we sample from.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='80%' src='project/programmatic-midi/section-patterns.png'/>)}
              {wrapContent(<img width='100%' src='project/programmatic-midi/section-patterns.png'/>)}
            </WidthSwitch>
          </div>
          <h4>Conclusion</h4>
          <p>
            The final programmatic music generator outputs satisfactory results. However, there do exist unfavorable generations.
            Supplementing real training data with synthetic training data generated by this algorithm did not have a significant
            qualitatively observable impact on the music generated by a Transformer-XL architecture. The code for the model
            is available at <a>https://github.com/vm2781/remi</a>.
          </p>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'clockwork-robotic-arm',
    title: 'Clockwork Robotic Arm',
    date: '2025-02-16',
    status: 'ON_HOLD',
    technologies: ['CAD', 'Fusion360', 'Robotics'],
    page: fullpage => {
      return (
        <div>
          <h4>Description</h4>
          <p>
            3D printing is incredible, and gears are fun. I was mulling over my sore lack of a personal robotic arm
            on which to conduct machine learning experiments, and then thought of making my own.
            But then came to mind the hassle of electronics. Why not just skip the electronics?
          </p>
          <p>
            Clockwork is fascinating to look at. An escapement mechanism allows for controlled releases of energy from
            some stored potential energy source - typically gravity or a spring. So, let's try building a fully mechanical
            yet programmable robotic arm.
          </p>
          <p>
            The basic idea I have is that the arm's movements will occur in ticks, just like a clock. An escapement
            will regularly progress the arm's movement. We can manually control the movement of the arm by pulling
            levers that redirect mechanical power through different gears. If we can do that, then we can write
            simple programs consisting of lists of instructions that are fed through a conversion unit.
            Punch cards sure would be dandy.
          </p>
          <p>
            The more difficult and tedious part than wishful brainstorming is the actual engineering of the mechanism.
            One feature I'd like is unlimited rotation of joints where physically allowed. Many electromechanical
            robotic arms have rotation limits because the wires hidden inside will twist. You can get around this
            using concentric conductive rings where electrical connections ride a shuttle around to avoid wire twist.
            I'd like to make a gear-based version of this concept.
          </p>
          <p>
            Here, I sketch out concept drawings for the arm, and begin printing parts for the base joint.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(
                <>
                  <img width='30%' src='project/clockwork-robotic-arm/sketch1.jpg'/>
                  <img width='30%' src='project/clockwork-robotic-arm/parts.jpg'/>
                </>
              )}
              {wrapContent(
                <>
                  <img width='50%' src='project/clockwork-robotic-arm/sketch1.jpg'/>
                  <img width='50%' src='project/clockwork-robotic-arm/parts.jpg'/>
                </>
              )}
            </WidthSwitch>
          </div>
          <p>
            I then spent days designing a mechanical version of the concentric conductive twist joint power transmissions.
            The pictured mechanism should be capable of transferring 4 independent power chains up the arm to other joints.
          </p>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='30%' src='project/clockwork-robotic-arm/cad.png'/>)}
              {wrapContent(<img width='30%' src='project/clockwork-robotic-arm/cad.png'/>)}
            </WidthSwitch>
          </div>

          <h4>Project on Hold</h4>
          <p>
            I have become busy with research at GRAIL and other projects, so this will have to wait for the foreseeable future.
          </p>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'chess',
    repository: 'https://github.com/jaron-cui/jaron-cui.github.io/tree/master/src/page/extraneous/chess',
    title: 'Chess',
    date: '2024-02-10',
    status: 'ON_HOLD',
    technologies: ['TypeScript', 'PixiJS'],
    page: fullpage => {
      return (
        <div>
          <h4>Preview</h4>
          Here is a snapshot of progress on the project. Visit <a href='https://jaron-cui.github.io/#/chess'>https://jaron-cui.github.io/#/chess</a> for the latest version.

          <Chess/>

          <h4>Info</h4>
          <p>
            This is my attempt at efficiently implementing chess!
            There are a few things we want to be able to do:
          </p>
          <ul>
            <li>Determine legal moves</li>
            <li>Indicate to the player all their currently allowed moves</li>
          </ul>
          <p>
            The approach I decided to take was one where we maximally cache information
            regarding potential moves. Every square on the board keeps a list of coordinates
            from which pieces can move to it and a list of coordinates that should recalculate
            possible moves if the square is updated.
          </p>
          <p>
            For example, a rook, which can move in a straight line of any length, will be
            obstructed by pieces in its path. All the squares which it can currently move to
            will store its position. Squares in the rook's path which hold a piece will also
            store its position, but tagged as 'If this square changes, check with me!'.
          </p>
          <p>
            This approach avoids recalculating every possible move after every turn, making
            it fast and straightforward to tell where pieces can move.
          </p>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'rect',
    repository: 'https://github.com/jaron-cui/jaron-cui.github.io/tree/master/src/page/extraneous/rect',
    title: 'Get Rect Remastered',
    date: '2024-01-04',
    status: 'ACTIVE',
    technologies: ['TypeScript', 'PixiJS', 'WebGL'],
    features: ['Physics', 'Graphics'],
    page: fullscreen => {
      return (
        <div>
          <h4>Features</h4>
          <ul>
            {[
              'Custom 2D physics engine',
              'WebGL shader terrain rendering',
              'Platformer movement'
            ].map(s => <li>{s}</li>)}
          </ul>
          <h4>Preview</h4>
          <p>Try using WASD to control the player!</p>
          <p>Visit <a href='https://jaron-cui.github.io/#/rect'>https://jaron-cui.github.io/#/rect</a> for the latest version.</p>
          <Rect/>
          <h4>Description</h4>
          <p>
            This is an attempt to recreate the first game I made, "get_rect()".
          </p>
          <p>
            The original game was PVP with destructible tiled terrain. There were numerous weapons and props at the player's disposal.
          </p>
          <p>
            It was multiplayer in the sense that two players would control their avatars from the same device, one using WASD, and the other using the arrow keys.
          </p>
          <p>
            Fireworks, TNT, bow & arrows, swords, throwable logs were acquirable by parachuted crates falling from the sky.
          </p>
          <p>
            Being the first game I had created, the physics were simplistically and not so carefully crafted. The implementations were incredible far from optimal. One early mistake I made was loading each block texture from file for every single block on the screen, every frame.
          </p>
          <p>
            This new version will use the arsenal of programming skills and mathematical knowledge I've gained since high school to build a better, faster, and even more fun online multiplayer game in the same spirit.
          </p>
        </div>
      );
    }
  }, {
    legacy: false,
    id: 'robotic-hand',
    title: 'Robotic Hand',
    date: '2024-02-01',
    status: 'COMPLETED',
    repository: 'https://github.com/jaron-cui/robotic-hand',
    technologies: ['Python', '3D Printing', 'CAD', 'Computer Aided Design', 'Fusion360', 'Blender'],
    page: fullscreen => {
      return (
        <div>
          <div style={{paddingBottom: '40px'}}>
            <WidthSwitch>
              {wrapContent(<img width='30%' src='project/robot-hand/robot-hand-side.jpg'/>)}
              {wrapContent(<img width='100%' src='project/robot-hand/robot-hand-side.jpg'/>)}
            </WidthSwitch>
          </div>
          <div style={{paddingBottom: '40px'}}>
            <h4>Description</h4>
            <p>
              Have you ever chased the warmth of friendship and comraderie?
              The joy of recalling fond memories involving shared experiences?
              We should feel grateful to have been granted existence, for these pleasures are precious <i>because</i> they are few and fleeting.
              Only the living can take the mundane for granted.
            </p>
            <p>
              ...but what if instead, you had a cool robotic arm to play games with you, no social interaction required??
              That's precisely the thought I had in early 2024! With a 3D printer, CAD skills, and computer science, the possibilities are limited!
              I assembled a team to make this dream a reality.
              Bringing the firmware skills of <a href='https://www.linkedin.com/in/iyerraj/'>Rajiv Iyer</a> and
              the programming prowess of <a href='https://www.linkedin.com/in/eric-m-823937179/'>Eric Ma</a> onboard,
              we set out to build this thing from nothing.
            </p>
            <p>
              We settled on the concept of a robotic arm capable of spontaneously reciprocating games of rock-paper-scissors with passerby.
              The arm would constantly analyze a camera feed directed at its engagement zone for human hands performing the characteristic
              downward swings of a game-seeking fist. Then, the arm would anticipate and match the motion for 3 swings while chanting 
              "rock, paper, SCISSORS!" before throwing a move and responding to the outcome of the match.
              A word of warning: this robot is NOT sportsmanlike.
            </p>
            <p>
              We delegated 3 objectives between me (1), Rajiv (2), and Eric (3):
            </p>
            <ol>
              <li>Design, fabricate the parts of, and physically construct the robotic arm</li>
              <li>Implement firmware for controlling the robotic arm from a computer</li>
              <li>Implement AI for directing the behavior of the robotic arm</li>
            </ol>
            <p>
              We were able to successfully complete these objectives in loose parallel, and you can see the results of our work below.
            </p>
            <Clip link='https://youtube.com/embed/By0YNmuQ91c?playlist=By0YNmuQ91c&loop=1'/>
          </div>
          <div style={{paddingBottom: '40px'}}>
            <h4>Constructing the Robot</h4>
            <h5>Proof of Concept</h5>
            <p>
              Initially, I aimed to build some sort of robot using multiple joints.
              However, placing a motor at each joint would be a major limiting factor.
              Motors need wiring and can be heavy! So, I decided to take inspiration
              from biological muscles and attempt to use tension to actuate segments around a jointed skeleton.
              This would allow the motors to be mounted in a more centralized and secure location instead of at the joints.
              The proof of concept was a bulky and rough hinged mechanism held straight with a spring
              and pulled shut with a cable. (The spring was a rubber band and the cable was dental floss...)
            </p>
            <p>
              Once this worked, I quickly iterated to refining a single finger and then incorporating multiple into a hand.
              The viability of the mechanism led me to decide on the direction based around a robotic hand.
            </p>
            <ProjectEntryGallery media={[{
                type: 'image',
                link: 'project/robot-hand/robot-hand-finger-prototype.gif',
                description: 'Proof-of-concept'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-finger-comparison.jpg',
                description: 'Refining finger to improve maximum retraction'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand.gif',
                description: 'Integrating fingers into a single palm'
              }
            ]}/>
            <h5>Arm Structure</h5>
            <p>
              There are two main types expressive motions required for rock-paper-scissors - hand gestures and arm movement.
              We have the hand with individually movable fingers, so next comes an arm.
              A forearm is sufficient, as the ritual for starting a game simply involves bobbing a fist rhythmically.
              But how do we communicate tension from the motors to the hand if between them lies an arm?
              We can run cables down the arm. But another problem - if we run the cables on top of or under the arm,
              then the cables could be stretched or relaxed by arm rotation even if the motors for the fingers are
              stationary. This is no good - we don't want the hand gesture to change due to arm movement.
              But this does not happen if the cables run through the arm's axis of rotation.
            </p>
            <p>
              For these reasons, cables run through guides down the center of the forearm into a guide mounted on the base plate.
              The guide mounted on the base plate is fitted to rotate freely to minimize the cable displacement caused by arm rotation.
              Cables go through this guide and then down below the base plates to where the motors will eventually reside.
            </p>
            <ProjectEntryGallery media={[{
                type: 'image',
                link: 'project/robot-hand/robot-hand-arm-sketch.jpg',
                description: 'Rough design sketch'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-mounted-guide.jpg',
                description: 'The freely rotating base-plate mounted cable guide'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-unmotorized-arm.jpg',
                description: 'The arm installed on base plate with threaded cables'
              }
            ]}/>
            <h5>Motorization</h5>
            <p>
              Next came the motorization of these mechanisms. I decided to use the small and
              cheap <a href='https://www.mouser.com/datasheet/2/758/stepd-01-data-sheet-1143075.pdf'>28BYJ-48 – 5V Stepper Motor</a>.
              Since the finger retraction is tension-based and may required tuning, it seems logical to use a winch made of swappable
              parts that can be calibrated physically with adjustments to the gears and have its range tweaked in code.
              For the elbow, we can just have the motor's axle angle be proportional to the arm's rotation angle.
            </p>
            <p>
              I specifically designed the winch's spool gear meshed with the driving gear as a partial gear (it has a section without teeth).
              This is so that any mistakes in the control programming won't put cables under critical tension in the event that the 
              motor over-retracts. It is easier to amend code than it is to replace snapped parts. For reference, each of the three
              segments in a single finger may take around 40 minutes to print, and the tiny bolts used in the hinges between them take
              8 minutes. The largest part in the robot took 5-6 hours to print.
            </p>
            <ProjectEntryGallery media={[{
                type: 'image',
                link: 'project/robot-hand/robot-hand-finger-winch.jpg',
                description: 'The motorized winch for controlling finger retraction'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-elbow-motor.jpg',
                description: 'The motor mount for controlling arm rotation'
              }
            ]}/>
            <p>
              I decided to attach a lead cable ending with an alligator clip to the finger winches for convenient coupling/decoupling
              with the finger cables. This is useful for when the base plate needs to be remove for maintenance and for fine-tuning
              cable tensions. Below, see the positioning of the finger winches in a compartment below the base plate and the situation
              of the elbow motor on top of the base plate.
            </p>
            <ProjectEntryGallery media={[{
                type: 'image',
                link: 'project/robot-hand/robot-hand-finger-winch-positioning.jpg',
                description: 'The motorized finger winches live under the base plate'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-finger-winch-mounted.jpg',
                description: 'A motorized winch hooked up to the corresponding finger cable'
              }, {
                type: 'image',
                link: 'project/robot-hand/robot-hand-elbow-motor-meshing.jpg',
                description: 'The motor mount for controlling arm rotation'
              }
            ]}/>
            <h5>Control</h5>
            <p>
              Finally, now that the methods of actuation and motorization are established, we move on to the control hardware.
              Since the robot's AI will require rapid image processing, it makes sense for it to live on a performant personal
              computer rather than an onboard processing unit. So, we will use lightweight controllers that simply receive commands
              from a device via serial connection.
              We chose to use the <a href='https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/hw-reference/esp32s3/user-guide-devkitm-1.html'>ESP-32S Development Board</a> as a microcontroller.
              Here is what the guts of the robot looked like after installing all finger winches, cable guides, wiring, and controllers.
            </p>
            <WidthSwitch>
              {wrapContent(
                <>
                  <img width='30%' src='project/robot-hand/robot-hand-guts.jpg'/>
                  <img width='30%' src='project/robot-hand/robot-hand-guts2.jpg'/>
                </>
              )}
              {<>
                {wrapContent(<img width='100%' src='project/robot-hand/robot-hand-guts.jpg'/>)}
                {wrapContent(<img width='100%' src='project/robot-hand/robot-hand-guts2.jpg'/>)}
              </>}
            </WidthSwitch>
          </div>
          <div style={{paddingBottom: '40px'}}>
            <h4>Software/AI</h4>
            <h5>Detecting Game Start Ritual</h5>
            <p>
              The game start ritual between humans involves making a fist, extending the arm outward, and then rhythmically swinging
              down three times before switching to a move gesture on the final swing. We can simplify the tracking of this procedure
              by replacing arm movement with the stand-in metric of hand position. If a hand is bobbing up and down, we will
              interpret this as the arm bobbing up and down. Even though it could be the camera moving or the entire human moving,
              for our purposes it is plausible enough to assume that an opponent is indeed offering a challenge.
            </p>
            <p>
              Since we need to identify the hand to read its gesture anyway, this abstraction doubles as allowing the start ritual
              to be identified without requiring any additional computer vision computation. We can read the hand's y-position and
              record its evolution over time. By fitting the position to an oscillating function, we can detect the ritual,
              estimate the tempo of the movement, and reciprocate the motion. We chose to regress the data against a sine wave
              because of its simplicity. A function that more accurately reflects the assymetrical velocity of the arm between
              upwards and downwards swings could potentially improve the performance of this technique.
            </p>
            {wrapContent(<img src='project/robot-hand/robot-hand-initiate-graphic.png'/>)}
            <h5>Perception <i>(CREDIT: Section Authored by Eric Ma)</i></h5>
            <p><i>Detection, landmarking, gesture recognition</i></p>
            <p>
              We started with a third-party model from
              Google's <a href='https://developers.google.com/mediapipe/solutions/vision/gesture_recognizer'>MediaPipe</a> as
              the basis for hand perception. This model is a combination of multiple, providing hand detection, hand landmarking,
              and gesture recognition, with support for live video. According to the model card, the landmarking portion uses a CNN,
              and gesture recognition uses fully connected networks to perform classification on an embedding of the landmarks.
              The model showed good performance for the prior two, but gesture recognition was unreliable for poses in rock-paper-scissors.
              We fine-tuned the model on these poses, and obtained much better results.
            </p>
            <p><i>Position tracking</i></p>
            <p>
              The MediaPipe model provides landmarking and therefore tracking for the hand, but it's suboptimal when there's fast movement,
              and can drop frames during periods of heavy computation. To compensate for samples that may be missed for these reasons,
              we added a second tracker provided by OpenCV to serve as backup when needed.
              We settled on a filter based on <a href='https://arxiv.org/abs/1611.08461'>Discriminative Correlation Filter with Channel and Spatial Reliability (CSRT)</a>,
              which showed the best results for this particular purpose, even when rate-limited due to its performance cost.
            </p>
            <h5>State Machine</h5>
            <p>
              By constantly visually monitoring the engagement region, the robot can detect when a game has started and act on it.
              The robot's behavior is elegantly described by a state machine.
            </p>
            {wrapContent(<img src='project/robot-hand/robot-hand-state-machine.jpg'/>)}
            <label>State Machine Diagram Credit: Eric Ma, Rajiv Iyer, Jaron Cui</label>
          </div>
          <div style={{paddingBottom: '40px'}}>
            <h4>Afterword</h4>
            <p>
              This concludes the journey of developing the arm. I learned a lot from the project, first and foremost that
              the 28BYJ-48 stepper motor is VERY WEAK. So many headaches having to do with the sheer lack of power these things
              can exert. And when they do exert force towards their upper limit, they heat up so much that they melt the PLA
              I used to print the gears and motor mounts. I will definitely keep this in mind for future projects, and I may
              revisit the concept of robotic arms with a trove of experience.
              This was the first robot I've ever built, so I'm certain I can do much better!
            </p>
            <p>
              Thank you for reading until the end. It took a long time to write. Like 4hrs. See you!
            </p>
          </div>
        </div>
      )
    }
  }
]