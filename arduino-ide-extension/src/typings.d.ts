declare module 'minimatch';
declare module 'react-window' {
  import * as React from 'react';
  export function areEqual(prevProps: any, nextProps: any): boolean;
  export class FixedSizeList extends React.Component<any, any> {
    scrollToItem(index: number, align?: string): void;
  }
}
