/**
 * Every number worth an argument. The piece is a fixed composition, so most
 * of these are framing decisions rather than gameplay feel: move one and the
 * picture changes.
 */
export const CONFIG = {
  camera: {
    // The camera never moves, and it looks at the planet's own centre, so
    // the world sits dead centre in the square. It is a little above the
    // equator, which is the only thing keeping the view from reading flat.
    position: [0, 60, 470],
    lookAt: [0, 0, 0],
    fov: 34,
    near: 2,
    far: 30000,
  },

  planet: {
    /** On-screen radius of the world, in the artwork's own units. The
     *  generated planet is built at its own scale (see world/specs.js) and
     *  scaled to meet this, so the game's terrain constants stay honest. */
    radius: 100,
    /**
     * The world's pole, as a world-space direction rather than Euler angles.
     * It only has to look right now — with the game's unlit terrain there is
     * no terminator and no ring shadow to line up against.
     */
    poleAxis: [0.201, 0.839, -0.505],
    /**
     * rad/s about that pole, while a world is holding. The angle unwinds to
     * zero across the coming-apart — a reassembled world is a NEW world and
     * owes the old one no orientation — which is also what keeps the whole
     * piece periodic over one turn of the five.
     */
    spin: 0.052,
  },

  // How a world is grown, and what happens when it stops being that world.
  world: {
    /** Icosphere subdivision for the terrain: 20*(d+1)^2 faces, one mote each. */
    detail: 64,
    /**
     * How much of the terrain's height actually reaches the geometry.
     *
     * The painter needs the FULL height to decide anything — where the
     * shoreline is, where the dry uplands start, where the snow line
     * wobbles. But a world with a fifth of its radius in relief reads as a
     * potato from outside. So the paint gets the whole height field and the
     * vertices get a fraction of it: every coastline, snowcap and rock face
     * stays exactly where it was, and the limb comes back to a circle.
     */
    relief: 0.34,
    /**
     * How many worlds the sequence runs before repeating. 0 is the honest
     * answer — the generator can make them forever, and a page left open
     * should never show you the same planet twice.
     *
     * Set it to a number only to RECORD: a video has to close on itself, so
     * the capture wraps the sequence at five and hold + change = 4 makes the
     * whole piece exactly periodic over twenty seconds.
     */
    loopEvery: 0,
    /**
     * Hand-picked world numbers, in order. Empty is the shipped state — the
     * page invents its own. Filling it in overrides the sequence entirely
     * and wraps at the end, which is how a recording gets a set of worlds
     * chosen for how they look next to each other rather than for what the
     * seed happened to roll.
     */
    playlist: [],
    /** Seconds a world holds before it comes apart. */
    hold: 2.6,
    /** Seconds the coming-apart takes, end to end. */
    change: 1.4,
    /** Per-frame budget for growing the NEXT world in the background. */
    budgetMs: 14,
    /**
     * How far the shell swells at full scatter, in the world's own units.
     *
     * There is less headroom here than it looks: the world already fills
     * 0.72 of the half-frame, and at this camera distance the silhouette of
     * a sphere grows by asin(r/d), not linearly — so a swell that looks
     * modest in numbers puts the debris straight off the edge of the tube.
     * This lands the shell at about 0.95, which nearly fills the screen and
     * still leaves the corners dark enough to read it as a sphere.
     */
    bulge: 275,
    /** How coarsely the crust breaks up: low numbers, big slabs. */
    clump: 5.5,
    /** Radians of twist about the pole at full scatter. */
    swirl: 0.95,
    /** Radians each slab turns about its own axis on the way across. */
    tumble: 2.6,
    /** Seconds of tremor before a world lets go. */
    warn: 0.7,
    /** Size of one mote, in the artwork's units (a face is about this wide). */
    moteSize: 1.35,
    /** Colour ladder the terrain is quantized onto — the game's dither steps. */
    posterizeSteps: 25,
  },

  // Direction TOWARD the light. The world itself is unlit — the game paints
  // it rather than shading it — so this only reaches the things standing on
  // and above it: cloud banks, crystal, rock.
  sun: [-0.55, 0.42, 0.20],

  render: {
    /** Cap on the square canvas's backing-store size, in device pixels. */
    maxPixels: 1600,
    /**
     * The internal square resolution EVERYTHING is drawn at, before being
     * blown back up with nearest sampling. This is the single number that
     * decides how much like a 1998 console the piece looks.
     */
    lowRows: 336,
    bloomStrength: 0.34,
    bloomThreshold: 0.86,
    /** Where the highlight shoulder starts; below this the grade is identity. */
    knee: 0.80,
    exposure: 1.24,
    saturation: 1.18,
    /** Colour ladder — the game's `ditherLevels`. Everything lands on it. */
    levels: 26,
    /** Ordered-dither strength, in ladder steps. */
    dither: 0.9,
    grain: 0.022,
    aberration: 0.0022,
    // The tube.
    curve: 0.055,
    scanlines: 0.17,
    grille: 0.08,
    /** Output pixels per grille stripe (three stripes make a triad). */
    grillePitch: 3.0,
    roll: 0.045,
    vignette: 0.26,
    /** Corner rounding, as a fraction of the half-frame. */
    corner: 0.13,
  },

  toon: {
    /** Bands in the cel ramp for the things that ARE lit: cloud, rock, moon. */
    steps: 4,
  },

};
