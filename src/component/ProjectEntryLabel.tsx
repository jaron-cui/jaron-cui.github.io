import type { JSX } from 'react';
import { Button } from "@mui/material";
import { BUTTON_STYLE, CENTERED_VERTICAL, DEFAULT_FONT, TRUNCATE_TEXT } from "../util/styles";
import { ProjectInfo, ProjectStatus } from "../util/types";
import { formatDateString } from "../util/util";
import WidthSwitch from "./WidthSwitch";

export type ProjectEntryProps = ProjectInfo & {
  open: boolean;
  setOpen: (value: boolean) => void;
}

const STATUS_COLORS = {
  COMPLETED: '#447744',
  ON_HOLD: '#886675',
  ACTIVE: '#55BB44'
}

const STATUS_LABELS = {
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  ACTIVE: 'Active'
}

function LabelContainer({ children, locked, onClick }: { children: JSX.Element, locked: boolean, onClick: () => void }) {
  return (
    <Button disableRipple={locked} onClick={onClick} sx={{
      ...DEFAULT_FONT,
      ...BUTTON_STYLE,
      '&:hover': locked ? {backgroundColor: BUTTON_STYLE.backgroundColor} : BUTTON_STYLE['&:hover'],
      color: 'black',
      textAlign: 'left',
      textTransform: 'unset !important',
      width: '100%',
      justifyContent: 'flex-start'
    }}>
      {children}
    </Button>
  );
}

function Header({ title, technologies }: { title: string, technologies: string[] }) {
  return (
    <>
      <h5 style={TRUNCATE_TEXT}>{title}</h5>
      <div style={TRUNCATE_TEXT}>{technologies.join(', ')}</div>
    </>
  )
}

function Date({ date }: { date: string }) {
  return (
    <i>{formatDateString(date)}</i>
  );
}

function StatusIndicator({ status } : { status: ProjectStatus }) {
  return (
    <div style={{
      width: '80px',
      borderRadius: '3px',
      backgroundColor: STATUS_COLORS[status],
      color: 'white',
      textAlign: 'center'
    }}>
      {STATUS_LABELS[status]}
    </div>
  )
}

function WideProjectEntryLabel(props: ProjectEntryProps & { locked?: boolean }) {
  return (
    <LabelContainer locked={!!(props.locked)} onClick={() => props.setOpen(!props.open)}>
      <span style={{width: '100%', maxWidth: '100%'}}>
        <span style={{
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span style={{ width: 'calc(100% - 160px)' }}>
            <Header title={props.title} technologies={props.technologies}/>
          </span>
          <span style={{display: 'flex', flexDirection: 'row'}}>
            <div className='vr'></div>
            <span style={{ ...CENTERED_VERTICAL, width: '120px', marginLeft: '10px', marginRight: '10px'}}>
              <Date date={props.date}/>
              <span style={{ margin: '10px' }}>
                <StatusIndicator status={props.status}/>
              </span>
            </span>
          </span>
        </span>
      </span>
    </LabelContainer>
  );
}

function NarrowProjectEntryLabel(props: ProjectEntryProps & { locked?: boolean }) {
  return (
    <LabelContainer locked={!!(props.locked)} onClick={() => props.setOpen(!props.open)}>
      <span style={{width: '100%'}}>
        <Header title={props.title} technologies={props.technologies}/>
        <hr style={{ height: '2px'}}/>
        <span style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
          <Date date={props.date}/>
          <StatusIndicator status={props.status}/>
        </span>
      </span>
    </LabelContainer>
  )
}

export default function ProjectEntryLabel(props: ProjectEntryProps & { locked?: boolean }) {
  return (
    <WidthSwitch>
      <WideProjectEntryLabel {...props}/>
      <NarrowProjectEntryLabel {...props}/>
    </WidthSwitch>
  );
}