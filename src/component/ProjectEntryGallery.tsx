import type { JSX } from 'react';
import { Tooltip } from "@mui/material";
import { useState, useRef, useEffect, useReducer } from "react";
import { Media } from "../util/types";
import { toDownloadLink, mod } from "../util/util";
import { SideButton } from "./Buttons";

export default function ProjectEntryGallery({ media } : { media: Media[] }) {
  const [index, setIndex] = useState(0);
  const cachedMedia = useRef<JSX.Element[]>([]);
  const [_, rerender] = useReducer(x => x + 1, 0);

  const changeImage = (increment: number) => () => {
    const newIndex = mod(index + increment, media.length); 
    setIndex(newIndex);
  };

  useEffect(() => {
    cachedMedia.current = media.map(
      item => <img src={toDownloadLink(item.link)} style={{objectFit: 'contain', width: '100%'}}/>
    );
  }, []);

  return (
    <div style={{height: '300px', width: '100%', display: 'flex', justifyContent: 'center'}}>
      <SideButton direction='left' onClick={changeImage(-1)}/>
      <Tooltip title={media[index].description} leaveDelay={0}>
        <div style={{display: 'flex', backgroundColor: '#999999', height: '100%', width: 'max(50%, 700px)'}}>{<img src={toDownloadLink(media[index].link)} style={{objectFit: 'contain', width: '100%'}}/>}</div>
      </Tooltip>
      <SideButton direction='right' onClick={changeImage(1)}/>
    </div>
  );
}