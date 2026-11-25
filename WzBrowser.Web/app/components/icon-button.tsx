import type { ButtonHTMLAttributes, ComponentType, SVGProps, SyntheticEvent } from "react";

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Opens the label to the button's right, or to its left when it would pass the end of its [data-label-bounds]. */
function placeLabel({ currentTarget: button }: SyntheticEvent<HTMLElement>) {
    const box = button.getBoundingClientRect();
    const bounds = button.closest("[data-label-bounds]")?.getBoundingClientRect();
    const right = (bounds?.right ?? window.innerWidth) - box.right;
    const left = box.left - (bounds?.left ?? 0);
    const scale = box.width / button.offsetWidth || 1;
    const label = parseFloat(getComputedStyle(button, "::after").width) * scale;
    button.dataset.side = label > right && left > right ? "left" : "right";
}

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
    label: string;
    icon: IconType;
    /** "lg" is for buttons on the workspace rather than in a toolbar. */
    size?: "sm" | "lg";
};

/** A button that's only an icon until it's hovered or focused, when its label slides out of its side. */
export function IconButton({ label, icon: Glyph, size = "sm", className = "", ...props }: Props) {
    return (
        <button
            type="button"
            {...props}
            aria-label={label}
            data-label={label}
            onPointerEnter={placeLabel}
            onFocus={placeLabel}
            className={`icon-button label-reveal ${size === "lg" ? "icon-button-lg" : ""} ${className}`}
        >
            <Glyph className="size-4.5" />
        </button>
    );
}
