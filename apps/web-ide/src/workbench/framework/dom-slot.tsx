import { useLayoutEffect, useRef } from "react";

export class DomSlot {
  private readonly element: HTMLElement;
  private host: HTMLElement | null = null;
  private readonly onAttach?: (element: HTMLElement) => void;
  private readonly onDetach?: (element: HTMLElement) => void;

  constructor(
    element?: HTMLElement,
    options?: {
      onAttach?: (element: HTMLElement) => void;
      onDetach?: (element: HTMLElement) => void;
    },
  ) {
    this.element = element ?? document.createElement("div");
    this.onAttach = options?.onAttach;
    this.onDetach = options?.onDetach;
  }

  getElement(): HTMLElement {
    return this.element;
  }

  mount(host: HTMLElement): () => void {
    if (this.host === host && host.firstChild === this.element) {
      return () => undefined;
    }

    this.unmount();
    this.host = host;
    host.replaceChildren(this.element);
    this.onAttach?.(this.element);

    return () => {
      if (this.host === host) {
        this.unmount();
      }
    };
  }

  private unmount(): void {
    const host = this.host;
    if (!host) {
      return;
    }

    this.onDetach?.(this.element);
    if (host.firstChild === this.element) {
      host.removeChild(this.element);
    }
    this.host = null;
  }
}

export function createDomSlot(
  element?: HTMLElement,
  options?: {
    onAttach?: (element: HTMLElement) => void;
    onDetach?: (element: HTMLElement) => void;
  },
): DomSlot {
  return new DomSlot(element, options);
}

export function DomSlotHost(props: {
  slot: DomSlot;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) {
      return;
    }

    return props.slot.mount(ref.current);
  }, [props.slot]);

  return <div ref={ref} className={props.className} />;
}
