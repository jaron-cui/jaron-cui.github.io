import { DEFAULT_FONT, DEFAULT_MARGIN } from "../util/styles";

export default function NotFound(props: { message: string }) {
  return (
    <div style={{
        ...DEFAULT_FONT,
        ...DEFAULT_MARGIN,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
      <div style={{marginTop: '50px', fontSize: 90}}>404!</div>
      <div>{props.message}</div>
    </div>
  );
}