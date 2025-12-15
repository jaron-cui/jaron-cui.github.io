import { Carousel, Col, Row } from 'react-bootstrap';
import { Chess } from '../page/extraneous/chess/view';
import { Rect } from '../page/extraneous/rect/Rect';
import { NewProjectInfo } from './types';
import { wrapContent } from './util';
import WidthSwitch from '../component/WidthSwitch';
import Clip from '../Clip';
import ProjectEntryGallery from '../component/ProjectEntryGallery';

function YouTubeEmbed({ videoID }: { videoID: string }) {
  return (
    <iframe width='100%' height='480px' src={`https://youtube.com/embed/${videoID}?autoplay=1&showinfo=0&loop=1&rel=0`}></iframe>
  )
}

export const NEW_PROJECTS: NewProjectInfo[] = [
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
          <h4>Description</h4>
          TODO
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
          <h4>Description</h4>
          TODO
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
          TODO
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
          <h4>Description</h4>
          TODO
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
          TODO
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