import { useRef, useState } from "react";
import { CircularProgress } from "@mui/material";

export default function Clip(props: {link: string, width?: string, height?: string}) {

  return (
    <>
      <iframe id='video'
        src={props.link}
        allow='autoplay'
        width={props.width || "768"} height={props.height || "432"}>
      </iframe>
    </>
  );
}