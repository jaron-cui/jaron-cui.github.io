import{a as e}from"./rolldown-runtime-BWaJ3C7D.js";import{J as t,K as n,U as r,W as i,Y as a,q as o}from"./index-BrKODK5f.js";import{n as s,t as c}from"./jsx-runtime-DApVmHJR.js";import{N as l,P as u,b as d,d as f,i as p,n as m,p as h,t as g,v as _,y as v}from"./useForkRef-CTAIUB4j.js";import{f as y,p as ee}from"./Grow-D8g2061M.js";var b=e(s()),x=!0,S=!1,C=new y,w={text:!0,search:!0,url:!0,tel:!0,email:!0,password:!0,number:!0,date:!0,month:!0,week:!0,time:!0,datetime:!0,"datetime-local":!0};function T(e){let{type:t,tagName:n}=e;return!!(n===`INPUT`&&w[t]&&!e.readOnly||n===`TEXTAREA`&&!e.readOnly||e.isContentEditable)}function te(e){e.metaKey||e.altKey||e.ctrlKey||(x=!0)}function E(){x=!1}function D(){this.visibilityState===`hidden`&&S&&(x=!0)}function ne(e){e.addEventListener(`keydown`,te,!0),e.addEventListener(`mousedown`,E,!0),e.addEventListener(`pointerdown`,E,!0),e.addEventListener(`touchstart`,E,!0),e.addEventListener(`visibilitychange`,D,!0)}function O(e){let{target:t}=e;try{return t.matches(`:focus-visible`)}catch{}return x||T(t)}function re(){let e=b.useCallback(e=>{e!=null&&ne(e.ownerDocument)},[]),t=b.useRef(!1);function n(){return t.current?(S=!0,C.start(100,()=>{S=!1}),t.current=!1,!0):!1}function r(e){return O(e)?(t.current=!0,!0):!1}return{isFocusVisibleRef:t,onFocus:r,onBlur:n,ref:e}}a(),o();var k=h,A=re;function j(e){if(e===void 0)throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);return e}function M(e,t){var n=function(e){return t&&(0,b.isValidElement)(e)?t(e):e},r=Object.create(null);return e&&b.Children.map(e,function(e){return e}).forEach(function(e){r[e.key]=n(e)}),r}function N(e,t){e||={},t||={};function n(n){return n in t?t[n]:e[n]}var r=Object.create(null),i=[];for(var a in e)a in t?i.length&&(r[a]=i,i=[]):i.push(a);var o,s={};for(var c in t){if(r[c])for(o=0;o<r[c].length;o++){var l=r[c][o];s[r[c][o]]=n(l)}s[c]=n(c)}for(o=0;o<i.length;o++)s[i[o]]=n(i[o]);return s}function P(e,t,n){return n[t]==null?e.props[t]:n[t]}function F(e,t){return M(e.children,function(n){return(0,b.cloneElement)(n,{onExited:t.bind(null,n),in:!0,appear:P(n,`appear`,e),enter:P(n,`enter`,e),exit:P(n,`exit`,e)})})}function I(e,t,n){var r=M(e.children),i=N(t,r);return Object.keys(i).forEach(function(a){var o=i[a];if((0,b.isValidElement)(o)){var s=a in t,c=a in r,l=t[a],u=(0,b.isValidElement)(l)&&!l.props.in;c&&(!s||u)?i[a]=(0,b.cloneElement)(o,{onExited:n.bind(null,o),in:!0,exit:P(o,`exit`,e),enter:P(o,`enter`,e)}):!c&&s&&!u?i[a]=(0,b.cloneElement)(o,{in:!1}):c&&s&&(0,b.isValidElement)(l)&&(i[a]=(0,b.cloneElement)(o,{onExited:n.bind(null,o),in:l.props.in,exit:P(o,`exit`,e),enter:P(o,`enter`,e)}))}}),i}var L=Object.values||function(e){return Object.keys(e).map(function(t){return e[t]})},R={component:`div`,childFactory:function(e){return e}},z=function(e){i(a,e);function a(t,n){var r=e.call(this,t,n)||this;return r.state={contextValue:{isMounting:!0},handleExited:r.handleExited.bind(j(r)),firstRender:!0},r}var o=a.prototype;return o.componentDidMount=function(){this.mounted=!0,this.setState({contextValue:{isMounting:!1}})},o.componentWillUnmount=function(){this.mounted=!1},a.getDerivedStateFromProps=function(e,t){var n=t.children,r=t.handleExited;return{children:t.firstRender?F(e,r):I(e,n,r),firstRender:!1}},o.handleExited=function(e,n){var r=M(this.props.children);e.key in r||(e.props.onExited&&e.props.onExited(n),this.mounted&&this.setState(function(n){var r=t({},n.children);return delete r[e.key],{children:r}}))},o.render=function(){var e=this.props,t=e.component,i=e.childFactory,a=n(e,[`component`,`childFactory`]),o=this.state.contextValue,s=L(this.state.children).map(i);return delete a.appear,delete a.enter,delete a.exit,t===null?b.createElement(r.Provider,{value:o},s):b.createElement(r.Provider,{value:o},b.createElement(t,a,s))},a}(b.Component);z.propTypes={},z.defaultProps=R;var B=c();function ie(e){let{className:t,classes:n,pulsate:r=!1,rippleX:i,rippleY:a,rippleSize:o,in:s,onExited:c,timeout:l}=e,[u,f]=b.useState(!1),p=d(t,n.ripple,n.rippleVisible,r&&n.ripplePulsate),m={width:o,height:o,top:-(o/2)+a,left:-(o/2)+i},h=d(n.child,u&&n.childLeaving,r&&n.childPulsate);return!s&&!u&&f(!0),b.useEffect(()=>{if(!s&&c!=null){let e=setTimeout(c,l);return()=>{clearTimeout(e)}}},[c,s,l]),(0,B.jsx)(`span`,{className:p,style:m,children:(0,B.jsx)(`span`,{className:h})})}var V=_(`MuiTouchRipple`,[`root`,`ripple`,`rippleVisible`,`ripplePulsate`,`child`,`childLeaving`,`childPulsate`]);a(),o(),l();var H=[`center`,`classes`,`className`],U=e=>e,W,G,K,q,J=550,ae=u(W||=U`
  0% {
    transform: scale(0);
    opacity: 0.1;
  }

  100% {
    transform: scale(1);
    opacity: 0.3;
  }
`),oe=u(G||=U`
  0% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
`),se=u(K||=U`
  0% {
    transform: scale(1);
  }

  50% {
    transform: scale(0.92);
  }

  100% {
    transform: scale(1);
  }
`),ce=p(`span`,{name:`MuiTouchRipple`,slot:`Root`})({overflow:`hidden`,pointerEvents:`none`,position:`absolute`,zIndex:0,top:0,right:0,bottom:0,left:0,borderRadius:`inherit`}),le=p(ie,{name:`MuiTouchRipple`,slot:`Ripple`})(q||=U`
  opacity: 0;
  position: absolute;

  &.${0} {
    opacity: 0.3;
    transform: scale(1);
    animation-name: ${0};
    animation-duration: ${0}ms;
    animation-timing-function: ${0};
  }

  &.${0} {
    animation-duration: ${0}ms;
  }

  & .${0} {
    opacity: 1;
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background-color: currentColor;
  }

  & .${0} {
    opacity: 0;
    animation-name: ${0};
    animation-duration: ${0}ms;
    animation-timing-function: ${0};
  }

  & .${0} {
    position: absolute;
    /* @noflip */
    left: 0px;
    top: 0;
    animation-name: ${0};
    animation-duration: 2500ms;
    animation-timing-function: ${0};
    animation-iteration-count: infinite;
    animation-delay: 200ms;
  }
`,V.rippleVisible,ae,J,({theme:e})=>e.transitions.easing.easeInOut,V.ripplePulsate,({theme:e})=>e.transitions.duration.shorter,V.child,V.childLeaving,oe,J,({theme:e})=>e.transitions.easing.easeInOut,V.childPulsate,se,({theme:e})=>e.transitions.easing.easeInOut),ue=b.forwardRef(function(e,r){let i=m({props:e,name:`MuiTouchRipple`}),{center:a=!1,classes:o={},className:s}=i,c=n(i,H),[l,u]=b.useState([]),f=b.useRef(0),p=b.useRef(null);b.useEffect(()=>{p.current&&=(p.current(),null)},[l]);let h=b.useRef(!1),g=ee(),_=b.useRef(null),v=b.useRef(null),y=b.useCallback(e=>{let{pulsate:t,rippleX:n,rippleY:r,rippleSize:i,cb:a}=e;u(e=>[...e,(0,B.jsx)(le,{classes:{ripple:d(o.ripple,V.ripple),rippleVisible:d(o.rippleVisible,V.rippleVisible),ripplePulsate:d(o.ripplePulsate,V.ripplePulsate),child:d(o.child,V.child),childLeaving:d(o.childLeaving,V.childLeaving),childPulsate:d(o.childPulsate,V.childPulsate)},timeout:J,pulsate:t,rippleX:n,rippleY:r,rippleSize:i},f.current)]),f.current+=1,p.current=a},[o]),x=b.useCallback((e={},t={},n=()=>{})=>{let{pulsate:r=!1,center:i=a||t.pulsate,fakeElement:o=!1}=t;if(e?.type===`mousedown`&&h.current){h.current=!1;return}e?.type===`touchstart`&&(h.current=!0);let s=o?null:v.current,c=s?s.getBoundingClientRect():{width:0,height:0,left:0,top:0},l,u,d;if(i||e===void 0||e.clientX===0&&e.clientY===0||!e.clientX&&!e.touches)l=Math.round(c.width/2),u=Math.round(c.height/2);else{let{clientX:t,clientY:n}=e.touches&&e.touches.length>0?e.touches[0]:e;l=Math.round(t-c.left),u=Math.round(n-c.top)}if(i)d=Math.sqrt((2*c.width**2+c.height**2)/3),d%2==0&&(d+=1);else{let e=Math.max(Math.abs((s?s.clientWidth:0)-l),l)*2+2,t=Math.max(Math.abs((s?s.clientHeight:0)-u),u)*2+2;d=Math.sqrt(e**2+t**2)}e!=null&&e.touches?_.current===null&&(_.current=()=>{y({pulsate:r,rippleX:l,rippleY:u,rippleSize:d,cb:n})},g.start(80,()=>{_.current&&=(_.current(),null)})):y({pulsate:r,rippleX:l,rippleY:u,rippleSize:d,cb:n})},[a,y,g]),S=b.useCallback(()=>{x({},{pulsate:!0})},[x]),C=b.useCallback((e,t)=>{g.clear(),e?.type===`touchend`&&_.current?(_.current(),_.current=null,g.start(0,()=>{C(e,t)})):(_.current=null,u(e=>e.length>0?e.slice(1):e),p.current=t)},[g]);return b.useImperativeHandle(r,()=>({pulsate:S,start:x,stop:C}),[S,x,C]),(0,B.jsx)(ce,t({className:d(V.root,o.root,s),ref:v},c,{children:(0,B.jsx)(z,{component:null,exit:!0,children:l})}))});function de(e){return v(`MuiButtonBase`,e)}var fe=_(`MuiButtonBase`,[`root`,`disabled`,`focusVisible`]);a(),o();var pe=`action.centerRipple.children.className.component.disabled.disableRipple.disableTouchRipple.focusRipple.focusVisibleClassName.LinkComponent.onBlur.onClick.onContextMenu.onDragLeave.onFocus.onFocusVisible.onKeyDown.onKeyUp.onMouseDown.onMouseLeave.onMouseUp.onTouchEnd.onTouchMove.onTouchStart.tabIndex.TouchRippleProps.touchRippleRef.type`.split(`.`),me=e=>{let{disabled:t,focusVisible:n,focusVisibleClassName:r,classes:i}=e,a=f({root:[`root`,t&&`disabled`,n&&`focusVisible`]},de,i);return n&&r&&(a.root+=` ${r}`),a},he=p(`button`,{name:`MuiButtonBase`,slot:`Root`,overridesResolver:(e,t)=>t.root})({display:`inline-flex`,alignItems:`center`,justifyContent:`center`,position:`relative`,boxSizing:`border-box`,WebkitTapHighlightColor:`transparent`,backgroundColor:`transparent`,outline:0,border:0,margin:0,borderRadius:0,padding:0,cursor:`pointer`,userSelect:`none`,verticalAlign:`middle`,MozAppearance:`none`,WebkitAppearance:`none`,textDecoration:`none`,color:`inherit`,"&::-moz-focus-inner":{borderStyle:`none`},[`&.${fe.disabled}`]:{pointerEvents:`none`,cursor:`default`},"@media print":{colorAdjust:`exact`}}),Y=b.forwardRef(function(e,r){let i=m({props:e,name:`MuiButtonBase`}),{action:a,centerRipple:o=!1,children:s,className:c,component:l=`button`,disabled:u=!1,disableRipple:f=!1,disableTouchRipple:p=!1,focusRipple:h=!1,LinkComponent:_=`a`,onBlur:v,onClick:y,onContextMenu:ee,onDragLeave:x,onFocus:S,onFocusVisible:C,onKeyDown:w,onKeyUp:T,onMouseDown:te,onMouseLeave:E,onMouseUp:D,onTouchEnd:ne,onTouchMove:O,onTouchStart:re,tabIndex:j=0,TouchRippleProps:M,touchRippleRef:N,type:P}=i,F=n(i,pe),I=b.useRef(null),L=b.useRef(null),R=g(L,N),{isFocusVisibleRef:z,onFocus:ie,onBlur:V,ref:H}=A(),[U,W]=b.useState(!1);u&&U&&W(!1),b.useImperativeHandle(a,()=>({focusVisible:()=>{W(!0),I.current.focus()}}),[]);let[G,K]=b.useState(!1);b.useEffect(()=>{K(!0)},[]);let q=G&&!f&&!u;b.useEffect(()=>{U&&h&&!f&&G&&L.current.pulsate()},[f,h,U,G]);function J(e,t,n=p){return k(r=>(t&&t(r),!n&&L.current&&L.current[e](r),!0))}let ae=J(`start`,te),oe=J(`stop`,ee),se=J(`stop`,x),ce=J(`stop`,D),le=J(`stop`,e=>{U&&e.preventDefault(),E&&E(e)}),de=J(`start`,re),fe=J(`stop`,ne),Y=J(`stop`,O),ge=J(`stop`,e=>{V(e),z.current===!1&&W(!1),v&&v(e)},!1),_e=k(e=>{I.current||=e.currentTarget,ie(e),z.current===!0&&(W(!0),C&&C(e)),S&&S(e)}),X=()=>{let e=I.current;return l&&l!==`button`&&!(e.tagName===`A`&&e.href)},Z=b.useRef(!1),ve=k(e=>{h&&!Z.current&&U&&L.current&&e.key===` `&&(Z.current=!0,L.current.stop(e,()=>{L.current.start(e)})),e.target===e.currentTarget&&X()&&e.key===` `&&e.preventDefault(),w&&w(e),e.target===e.currentTarget&&X()&&e.key===`Enter`&&!u&&(e.preventDefault(),y&&y(e))}),ye=k(e=>{h&&e.key===` `&&L.current&&U&&!e.defaultPrevented&&(Z.current=!1,L.current.stop(e,()=>{L.current.pulsate(e)})),T&&T(e),y&&e.target===e.currentTarget&&X()&&e.key===` `&&!e.defaultPrevented&&y(e)}),Q=l;Q===`button`&&(F.href||F.to)&&(Q=_);let $={};Q===`button`?($.type=P===void 0?`button`:P,$.disabled=u):(!F.href&&!F.to&&($.role=`button`),u&&($[`aria-disabled`]=u));let be=g(r,H,I),xe=t({},i,{centerRipple:o,component:l,disabled:u,disableRipple:f,disableTouchRipple:p,focusRipple:h,tabIndex:j,focusVisible:U}),Se=me(xe);return(0,B.jsxs)(he,t({as:Q,className:d(Se.root,c),ownerState:xe,onBlur:ge,onClick:y,onContextMenu:oe,onFocus:_e,onKeyDown:ve,onKeyUp:ye,onMouseDown:ae,onMouseLeave:le,onMouseUp:ce,onDragLeave:se,onTouchEnd:fe,onTouchMove:Y,onTouchStart:de,ref:be,tabIndex:u?-1:j,type:P},$,F,{children:[s,q?(0,B.jsx)(ue,t({ref:R,center:o},M)):null]}))});export{A as n,k as r,Y as t};