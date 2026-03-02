import { Col, Row } from "react-bootstrap";
import Clip from "../../Clip";
import WidthSwitch from "../../component/WidthSwitch";
import { wrapContent } from "../../util/util";


export default function Marimba() {
  return (
    <div>
      <h3>Building a Personal Marimba</h3>
      {wrapContent(<Clip link='https://www.youtube.com/embed/fnrT9LNhCe0?si=vfL1YcFmCFj8Zx4u&loop=1&rel=0'/>)}
      <h4>Impetus</h4>
      <p>
        One my younger sisters plays the marimba in the high school band.
        Marimbas are essentially full wooden pianos, costing $4,000 for one on the cheaper side.
        So every time she wants to practice, she needs to stay after school when a teacher is present to unlock the band room.
        That is, until I decided to build one for her for around $300 in material costs.
      </p>
      <WidthSwitch>
        <Col>
          <img src="project/marimba/living-room.jpg" alt="Installing eye hooks" width='41%'/>
          <img src="project/marimba/frame.jpg" alt="Placing keys" width='59%'/>
        </Col>
        <Col>
          <Row>
            <img src="project/marimba/living-room.jpg" alt="Installing eye hooks" width='100%'/>
            <img src="project/marimba/frame.jpg" alt="Placing keys" width='100%'/>
          </Row>
        </Col>
      </WidthSwitch>
      <h4>Research</h4>
      <p>
        My prior knowledge of marimbas came essentially just from what I pictured a marimba to be -
        a set of suspended wooden blocks cut to lengths inversely proportional to their pitch.
        A few internet searches gave me the knowledge I needed to start: how to make a block of wood
        have a lower or higher pitch.
      </p>
      <p>
        The two primary factors that affect the pitch of a wooden key are its length and its rigidity.
        A longer key vibrates at a lower frequency (it takes more time for a vibration to travel the length),
        and a more rigid key vibrates at a higher frequency (stronger restoring force).
        These factors are controlled in practice by cutting the key to a specific length and carving wood
        out of its center (the removal of material reduces rigidity faster than mass).
        Thus, you first cut a wooden block such that it has a higher pitch than desired, and then carve
        to incrementally reduce it.
      </p>
      <p>
        In order to minimize interference with sound quality, the complete keys are strung on taut cables.
      </p>
      <h4>Proof-of-Concept Experiments</h4>
      <p>
        My first action was to create a minimal test setup to prove the viability of the marimba.
        I purchased a 1.5 x 0.75 x 72 inch red oak plank, eye hooks, and a bundle of paracord from Lowes.
        Then, I sawed two blocks off the plank, 7 and 14 inches long. These were meant to represent the
        aesthetically shortest and longest keys I wanted to install on the marimba.
        Placing these keys on the cables of a test rig, I struck them and confirmed that red oak keys with
        lengths in the interval [7, 14] inches could produce all the semitones required for a four-octave marimba
        from C5 to C9. 
      </p>
      <p>
        I have never done extensive woodwork. But I figured that a chisel and mallet should be sufficient for
        carving the keys. Taking the 14 inch test key, I incrementally chiseled a parabolic impression in the center,
        striking it against the ground occasionally to test its pitch.
        When it was close to C5 but still sharp, I placed it on cables and sprinkled sawdust over it.
        By repeatedly tapping it, the sawdust started collecting in two piles at opposite ends, indicating the location
        of the vibrational nodes. I drilled holes through the sides here for stringing cable. This was meant to minimize
        any dampening that might come from the suspension substrate. After, I chiseled a bit more until the pitch was no longer sharp.
      </p>
      <p>
        Next, I applied coats of wood stain and polyacrylic seal to represent the final look of the key.
        With this, I had produced a single finished key and demonstrated the process.
        I discovered that neither the drilled suspension holes nor the sealing coats noticeably altered the pitch. 
      </p>
      <h4>Making the Keys</h4>
      <p>
        I planned for the marimba to have 29 white keys and 20 black keys
        (white or black referring to the role of the key as on a piano), meaning I would have to make 49 individual keys.
        Each minute spent per key would mean nearly an extra hour total,
        and making the test key from start to finish took around an hour of labor.
        So, I invested half an hour planning how to streamline the process.
        I ended up cutting, chiseling, drilling, testing, and painting keys in large batches, reducing the per-key time to about
        12 minutes. Eliminate context switching!
      </p>
      <WidthSwitch>
        <Col>
          <Row>
            <Col>
              <img src="project/marimba/chisel-setup.jpg" alt="Chiseling setup" width='100%'/>
            </Col>
            <Col>
              <img src="project/marimba/chisel-pile.jpg" alt="Chiseled keys" width='100%'/>
            </Col>
            <Col>
              <img src="project/marimba/drill-pile.jpg" alt="Drilled keys" width='100%'/>
            </Col>
            <Col>
              <img src="project/marimba/paint-pile.jpg" alt="Stained and sealed keys" width='100%'/>
            </Col>
          </Row>
          <Col>
            <Clip width='60%' link='https://www.youtube.com/embed/sWjNLyihTdY?si=QHj87NXSSPhOk--n&loop=1&rel=0'/>
            <Clip width='40%' link='https://www.youtube.com/embed/7_DKkGn3H5M?si=kahAtw0BHCaV0wDw&loop=1&rel=0'/>
          </Col>
        </Col>
        <Col>
          <Row>
            <Clip link='https://www.youtube.com/embed/sWjNLyihTdY?si=QHj87NXSSPhOk--n&loop=1&rel=0'/>
            <Clip link='https://www.youtube.com/embed/7_DKkGn3H5M?si=kahAtw0BHCaV0wDw&loop=1&rel=0'/>
            <img src="project/marimba/chisel-setup.jpg" alt="Chiseling setup" width='100%'/>
            <img src="project/marimba/chisel-pile.jpg" alt="Chiseled keys" width='100%'/>
            <img src="project/marimba/drill-pile.jpg" alt="Drilled keys" width='100%'/>
            <img src="project/marimba/paint-pile.jpg" alt="Stained and sealed keys" width='100%'/>
          </Row>
        </Col>
      </WidthSwitch>
      <h4>Building the Stand</h4>
      <p>
        I designed the marimba to have a lower keyboard and an upper keyboard. The lower keyboard is for the white keys,
        and the upper keyboard is for the black keys. Each keyboard consists of two wooden rails down the length of the
        marimba, fixed together by cross beams. One of the rails is parallel to the central axis of the marimba, whereas
        the other is angled to acommodate the gradually increasing lengths of the keys.
        Keys are suspended between consecutive pairs of eye hooks on the rails.
      </p>
      <p>
        The keyboards sit atop a four-wheeled rectangular stand. I designed the stand such that it could be made out of
        the 2.5 and 1.5 inch wide, 0.75 inch thick red oak and maple planks I had already been using for the keys.
        Caster wheels are screwed to the bottom four corners.
      </p>
      <p>
        Finally, I strung the keys and mounted the keyboards. The marimba was complete!
      </p>
      <WidthSwitch>
        <Col>
          <Col>
            <img src="project/marimba/install-eyehooks.jpg" alt="Installing eye hooks" width='25%'/>
            <img src="project/marimba/place-keys.jpg" alt="Placing keys" width='25%'/>
            <img src="project/marimba/thread-setup.jpg" alt="Threading setup" width='25%'/>
            <img src="project/marimba/thread-keys.jpg" alt="Threading keys" width='14%'/>
          </Col>
          <Col>
            <img src="project/marimba/frame-plan.jpg" alt="Planning the frame" width='40%'/>
            <img src="project/marimba/frame-setup.jpg" alt="Assembly area" width='18.5%'/>
            <img src="project/marimba/frame-clamp.jpg" alt="Assembling the frame" width='18.5%'/>
            <img src="project/marimba/frame-screw.jpg" alt="Screwing the frame together" width='18.5%'/>
          </Col>
        </Col>
        <Col>
          <Row>
            <img src="project/marimba/install-eyehooks.jpg" alt="Installing eye hooks" width='100%'/>
            <img src="project/marimba/place-keys.jpg" alt="Placing keys" width='100%'/>
            <img src="project/marimba/thread-setup.jpg" alt="Threading setup" width='100%'/>
            <img src="project/marimba/thread-keys.jpg" alt="Threading keys" width='100%'/>
            <img src="project/marimba/frame-setup.jpg" alt="Assembly area" width='100%'/>
            <img src="project/marimba/frame-plan.jpg" alt="Planning the frame" width='100%'/>
            <img src="project/marimba/frame-clamp.jpg" alt="Assembling the frame" width='100%'/>
            <img src="project/marimba/frame-screw.jpg" alt="Screwing the frame together" width='100%'/>
          </Row>
        </Col>
      </WidthSwitch>
      <h4>Conclusion</h4>
      <p>
        The marimba turned out to have great sound and a sturdy construction. It now sits in our living room for
        my sister to practice on. The entire process took two and a half weeks, but the result will likely exist for decades.
        I consider this to be a pretty good way to have spent my winter break!
      </p>
    </div>
  );
}
