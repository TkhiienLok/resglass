import createPubSub from 'pub-sub-es';

import { uniqueify, TextManager } from './BedLikeTrack';
import { rectsAtPoint, clickFunc } from './Annotations1dTrack';

import TiledPixiTrack from './TiledPixiTrack';

// Services
import { tileProxy } from './services';

// Utils
import { colorToHex } from './utils';
import { GLOBALS } from './configs';

function drawAnnotation(
  track,
  graphics,
  origStrokeWidth,
  origStroke,
  origStrokeOpacity,
  fill,
  td,
  minSquareSize,
  xMin,
  xMax,
  yMin,
  yMax,
  minThres,
  flipDiagonal,
) {
  const startX = flipDiagonal
    ? track._xScale(td.yStart)
    : track._xScale(td.xStart);
  const endX = flipDiagonal ? track._xScale(td.yEnd) : track._xScale(td.xEnd);

  const startY = flipDiagonal
    ? track._yScale(td.xStart)
    : track._yScale(td.yStart);
  const endY = flipDiagonal ? track._yScale(td.xEnd) : track._yScale(td.yEnd);

  const uid = td.uid + flipDiagonal;

  const width = endX - startX;
  const height = endY - startY;

  let drawnRect = {
    x: startX,
    y: startY,
    width,
    height,
    value: td,
  };

  if (minSquareSize) {
    if (width < minSquareSize || height < minSquareSize) {
      drawnRect = {
        x: startX - minSquareSize / 2,
        y: startY - minSquareSize / 2,
        width: minSquareSize,
        height: minSquareSize,
      };
    }
  }

  track.drawnRects[uid] = [
    [
      drawnRect.x,
      drawnRect.y,
      drawnRect.x + drawnRect.width,
      drawnRect.y, // ur
      drawnRect.x + drawnRect.width,
      drawnRect.y + drawnRect.height, // ll
      drawnRect.x,
      drawnRect.y + drawnRect.height, // lr
    ],
    {
      value: td,
      fill,
    },
  ];

  const dRxMax = drawnRect.x + drawnRect.width;
  const dRyMax = drawnRect.y + drawnRect.height;

  // Only draw annotations that falls somehow within the viewport
  if (
    (drawnRect.x > xMin && drawnRect.x < xMax) ||
    (dRxMax > xMin && dRxMax < xMax) ||
    (drawnRect.y > yMin && drawnRect.y < yMax) ||
    (dRyMax > yMin && dRyMax < yMax)
  ) {
    if (drawnRect.width > minThres || drawnRect.height > minThres) {
      // console.log('x', drawnRect.x, 'y', drawnRect.y, 'xMin:', xMin, 'xMax', xMax);

      if (track.selectedRect === td.uid) {
        graphics.lineStyle(origStrokeWidth + 2, 0, 0.75);
      } else {
        graphics.lineStyle(origStrokeWidth, origStroke, origStrokeOpacity);
      }
      graphics.drawPolygon([
        drawnRect.x,
        drawnRect.y, // ul
        drawnRect.x + drawnRect.width,
        drawnRect.y, // ur
        drawnRect.x + drawnRect.width,
        drawnRect.y + drawnRect.height, // ll
        drawnRect.x,
        drawnRect.y + drawnRect.height, // lr
      ]);

      track.publish('annotationDrawn', {
        trackUuid: track.uuid,
        annotationUuid: uid,
        viewPos: [drawnRect.x, drawnRect.y, drawnRect.width, drawnRect.height],
        dataPos: [td.xStart, td.xEnd, td.yStart, td.yEnd],
        importance: td.importance,
        info: {
          patternType: track.options.patternType,
        },
      });
    }
  }
}

class ArrowheadDomainsTrack extends TiledPixiTrack {
  constructor(...args) {
    super(...args);

    this.drawnRects = {};

    // Create a custom pubSub interface
    const { publish, subscribe, unsubscribe } = createPubSub();
    this.publish = publish;
    this.subscribe = subscribe;
    this.unsubscribe = unsubscribe;

    this.rectGraphics = new GLOBALS.PIXI.Graphics();
    this.pMain.addChild(this.rectGraphics);
    this.selectedRect = null;

    this.vertY = 0;
    this.vertK = 1;
    this.prevY = 0;
    this.prevK = 1;

    this.textManager = new TextManager(this);
  }

  rerender(options, force) {
    super.rerender(options, force);

    for (const tile of this.visibleAndFetchedTiles()) {
      this.drawTile(tile);
    }

    this.drawnRects = {};
    this.updateExistingGraphics();
  }

  updateExistingGraphics() {
    const errors = this.checkForErrors();

    if (errors.length > 0) {
      this.draw();
      return;
    }

    this.uniqueSegments = uniqueify(
      this.visibleAndFetchedTiles()
        .map(x => x.tileData)
        .flat(),
    );

    this.textManager.updateTexts();

    this.uniqueSegments.forEach(td =>
      this.textManager.updateSingleText(td, 0, 0, td.fields[6]),
    );
    this.render();
  }

  selectRect(uid) {
    this.selectedRect = uid;

    this.render();
    this.animate();
  }

  /**
   * @param  {x} x position of the evt relative to the track
   * @param  {y} y position of the evt relative to the track
   */
  click(x, y) {
    const rects = rectsAtPoint(this, x, y);

    if (!rects.length) {
      this.selectRect(null);
    }
  }

  /** There was a click outside the track so unselect the
   * the current selection */
  clickOutside() {
    this.selectRect(null);
  }

  /*
   * The local tile identifier
   */
  tileToLocalId(tile) {
    // tile contains [zoomLevel, xPos, yPos]
    return `${tile.join('.')}`;
  }

  /**
   * The tile identifier used on the server
   */
  tileToRemoteId(tile) {
    // tile contains [zoomLevel, xPos, yPos]
    return `${tile.join('.')}`;
  }

  localToRemoteId(remoteId) {
    const idParts = remoteId.split('.');
    return idParts.slice(0, idParts.length - 1).join('.');
  }

  calculateZoomLevel() {
    const xZoomLevel = tileProxy.calculateZoomLevel(
      this._xScale,
      this.tilesetInfo.min_pos[0],
      this.tilesetInfo.max_pos[0],
    );
    const yZoomLevel = tileProxy.calculateZoomLevel(
      this._xScale,
      this.tilesetInfo.min_pos[1],
      this.tilesetInfo.max_pos[1],
    );

    let zoomLevel = Math.max(xZoomLevel, yZoomLevel);
    zoomLevel = Math.min(zoomLevel, this.maxZoom);

    return zoomLevel;
  }

  /**
   * Set which tiles are visible right now.
   *
   * @param tiles: A set of tiles which will be considered the currently visible
   * tile positions.
   */
  setVisibleTiles(tilePositions) {
    this.visibleTiles = tilePositions.map(x => ({
      tileId: this.tileToLocalId(x),
      remoteId: this.tileToRemoteId(x),
    }));

    this.visibleTileIds = new Set(this.visibleTiles.map(x => x.remoteId));
  }

  calculateVisibleTiles() {
    // if we don't know anything about this dataset, no point
    // in trying to get tiles
    if (!this.tilesetInfo) {
      return;
    }

    this.zoomLevel = this.calculateZoomLevel();
    // this.zoomLevel = 0;

    this.xTiles = tileProxy.calculateTiles(
      this.zoomLevel,
      this._xScale,
      this.tilesetInfo.min_pos[0],
      this.tilesetInfo.max_pos[0],
      this.tilesetInfo.max_zoom,
      this.tilesetInfo.max_width,
    );

    this.yTiles = tileProxy.calculateTiles(
      this.zoomLevel,
      this._yScale,
      this.tilesetInfo.min_pos[1],
      this.tilesetInfo.max_pos[1],
      this.tilesetInfo.max_zoom,
      this.tilesetInfo.max_width,
    );

    const rows = this.xTiles;
    const cols = this.yTiles;
    const zoomLevel = this.zoomLevel;

    // if we're mirroring tiles, then we only need tiles along the diagonal
    const tiles = [];

    // calculate the ids of the tiles that should be visible
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < cols.length; j++) {
        const newTile = [zoomLevel, rows[i], cols[j]];

        tiles.push(newTile);
      }
    }

    this.setVisibleTiles(tiles);
  }

  /**
   * Create whatever is needed to draw this tile.
   */
  initTile(/* tile */) {
    // this.drawTile(tile);
  }

  destroyTile() {
    // Nothing
  }

  draw() {
    this.drawnRects = {};

    super.draw();
    this.render();
  }

  render() {
    const graphics = this.rectGraphics;

    if (!graphics || !this.uniqueSegments) {
      return;
    }

    this.textManager.startDraw();

    graphics.clear();
    graphics.interactive = true;
    graphics.buttonMode = true;
    graphics.mouseup = evt => clickFunc(evt, this, '2d-rectangle-domains');
    // graphics.mouseover = evt => console.log('hover');

    const origStroke = colorToHex(
      this.options.rectangleDomainStrokeColor || 'black',
    );
    const fill = colorToHex(this.options.rectangleDomainFillColor || 'grey');

    const origStrokeWidth =
      typeof this.options.rectangleDomainStrokeWidth !== 'undefined'
        ? this.options.rectangleDomainStrokeWidth
        : 1;
    const origStrokeOpacity =
      typeof this.options.rectangleDomainStrokeOpacity !== 'undefined'
        ? this.options.rectangleDomainStrokeOpacity
        : 1;

    graphics.lineStyle(origStrokeWidth, origStroke, origStrokeOpacity);
    graphics.beginFill(
      fill,
      typeof this.options.rectangleDomainFillOpacity !== 'undefined'
        ? this.options.rectangleDomainFillOpacity
        : 0.4,
    );

    graphics.alpha = this.options.rectangleDomainOpacity || 0.5;

    const minSquareSize =
      this.options.minSquareSize && this.options.minSquareSize !== 'none'
        ? +this.options.minSquareSize
        : 0;

    const minThres = this.options.rectangleMinSize
      ? +this.options.rectangleMinSize
      : 0;

    const xMin = this._xScale.range()[0];
    const xMax = this._xScale.range()[1];
    const yMin = this._yScale.range()[0];
    const yMax = this._yScale.range()[1];

    if (!this.uniqueSegments.length) return;

    // line needs to be scaled down so that it doesn't become huge
    this.uniqueSegments
      .filter(td => !(td.uid in this.drawnRects))
      .forEach(td => {
        drawAnnotation(
          this,
          graphics,
          origStrokeWidth,
          origStroke,
          origStrokeOpacity,
          fill,
          td,
          minSquareSize,
          xMin,
          xMax,
          yMin,
          yMax,
          minThres,
          this.options.flipDiagonal === 'yes',
        );

        this.textManager.lightUpdateSingleText(
          td,
          this._xScale((td.xStart + td.xEnd) / 2),
          this._yScale((td.yStart + td.yEnd) / 2),
          {
            importance: td.importance,
            caption: td[6],
          },
        );

        if (this.options.flipDiagonal && this.options.flipDiagonal === 'copy') {
          drawAnnotation(
            this,
            graphics,
            origStrokeWidth,
            origStroke,
            origStrokeOpacity,
            fill,
            td,
            minSquareSize,
            xMin,
            xMax,
            yMin,
            yMax,
            minThres,
            true,
          );
        }
      });
    this.textManager.hideOverlaps();
  }

  exportSVG() {
    let track = null;
    let base = null;

    if (super.exportSVG) {
      [base, track] = super.exportSVG();
    } else {
      base = document.createElement('g');
      track = base;
    }
    const output = document.createElement('g');
    output.setAttribute(
      'transform',
      `translate(${this.position[0]},${this.position[1]})`,
    );

    track.appendChild(output);

    for (const flipDiagonal of [true, false]) {
      for (const tile of this.visibleAndFetchedTiles()) {
        // this tile has no data
        if (!tile.tileData || !tile.tileData.length) continue;

        tile.tileData.forEach(td => {
          const uid = td.uid + flipDiagonal;
          const gTile = document.createElement('g');
          gTile.setAttribute(
            'transform',
            `translate(${tile.graphics.position.x},${tile.graphics.position.y})scale(${tile.graphics.scale.x},${tile.graphics.scale.y})`,
          );
          output.appendChild(gTile);

          if (uid in this.drawnRects) {
            const rect = this.drawnRects[uid][1];

            const r = document.createElement('rect');
            r.setAttribute('x', rect.x);
            r.setAttribute('y', rect.y);
            r.setAttribute('width', rect.width);
            r.setAttribute('height', rect.height);

            r.setAttribute(
              'fill',
              this.options.rectangleDomainFillColor
                ? this.options.rectangleDomainFillColor
                : 'grey',
            );
            r.setAttribute('opacity', 0.3);

            r.style.stroke = 'black';
            r.style.strokeWidth = '1px';

            gTile.appendChild(r);
          }
        });
      }
    }

    return [base, base];
  }

  setPosition(newPosition) {
    super.setPosition(newPosition);

    this.pMain.position.y = this.position[1];
    this.pMain.position.x = this.position[0];
  }

  zoomed(newXScale, newYScale) {
    if (
      this.xScale().domain()[0] === newXScale.domain()[0] &&
      this.xScale().domain()[1] === newXScale.domain()[1] &&
      this.yScale().domain()[0] === newYScale.domain()[0] &&
      this.yScale().domain()[1] === newYScale.domain()[1]
    )
      return;

    this.xScale(newXScale);
    this.yScale(newYScale);

    this.refreshTiles();

    this.draw();
  }

  leftTrackDraw() {
    this.draw();
  }
}

export default ArrowheadDomainsTrack;
