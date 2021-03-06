import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
  ViewChildren,
  QueryList,
  ElementRef,
  OnDestroy
} from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import 'rxjs/add/observable/fromEvent';
import 'rxjs/add/operator/first';


import {
  ChessBoard,
  ChessEngine,
  ChessBoardController,
  BaseBlock,
  Block,
  Piece,
  GAME_STATE,
  PieceColor,
  PieceType
} from '../../../../../ng2-chess';
import { SVGChessBlock, SVGChessPiece, SVGChessBanner, SVGChessHighlight } from '../index';


const log = 'development' === ENV ? (msg) => console.log(msg) : (msg) => {};

export interface BlockDropEvent {
  block: SVGChessBlock,
  event: MouseEvent
}

export interface PieceDragEvent {
  piece: SVGChessPiece,
  event: MouseEvent
}

@Component({
  selector: 'chess-board',
  host: {

  },
  directives: [ SVGChessBlock, SVGChessPiece, SVGChessBanner, SVGChessHighlight ],
  styles: [ require('./svg-chess-board.styles.css') ],
  template: require('./svg-chess-board.template.html'),
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SVGChessBoard extends ChessBoard implements OnDestroy {

  /** @internal */
  height: number;
  /** @internal */
  width: number;

  blockSize: number;

  dragPiece: SVGChessPiece;

  private viewBox: string;
  private rxWaste: Subscription[] = [];
  private isBusy: boolean;
  private isDisabled: boolean;
  private banner: { title: string, message: string };

  private highlighted: Block[];

  @ViewChild('board') private boardElRef: ElementRef;
  @ViewChildren(<any>SVGChessBlock) private blocks: QueryList<SVGChessBlock>;
  @ViewChildren(<any>SVGChessPiece) private pieces: QueryList<SVGChessPiece>;


  constructor(public engine: ChessEngine, private cdr: ChangeDetectorRef) {
    super(ChessBoardController, engine);
    Object.defineProperty(this, 'height', {value: 600});
    Object.defineProperty(this, 'width', {value: 600});
    Object.defineProperty(this, 'viewBox', {value: `0 0 ${this.width} ${this.height}`});
    this.blockSize = this.height / engine.rowCount;
  }

  onStateChanged(newState: GAME_STATE): void {
    switch (newState) {
      case GAME_STATE.DRAW:
      case GAME_STATE.STALEMATE:
      case GAME_STATE.THREEFOLD_REPETITION:
      case GAME_STATE.INSUFFICIENT_MATERIAL:
        this.banner = {
          title: "GAME OVER",
          message: "It's a draw!"
        };
        this.clearSubscriptions();
        break;
      case GAME_STATE.CHECKMATE:
        const winner = this.engine.winner() === PieceColor.BLACK ? 'Black' : 'White';
        this.banner = {
          title: "GAME OVER",
          message: `${winner} wins!`
        };
        this.clearSubscriptions();
        break;
    }

    this.cdr.markForCheck();
    log('STATE CHANGE: ' + GAME_STATE[newState]);
  }

  onPieceDrag($event: PieceDragEvent): void {
    this.dragPiece = $event.piece;
  }

  ngOnDestroy() {
   this.clearSubscriptions();
  }

  newGame(): Promise<void> {
    this.clearSubscriptions();

    this.busy(false);
    this.blockUi(false);

    this.rxWaste.push(this.engine.boardSynced.subscribe( () => this.syncPiecesToBlocks() ));
    this.rxWaste.push(this.engine.stateChanged.subscribe(newState => this.onStateChanged(newState) ));

    this.banner = undefined;
    this.registerDragAndDrop();

    this.cdr.markForCheck();
    return Promise.resolve();
  }

  private clearSubscriptions() {
    while(this.rxWaste.length > 0) {
      this.rxWaste.pop().unsubscribe();
    }
  }

  /**
   * Enable / Disable user interaction with the board
   */
  blockUi(value: boolean): void {
    this.isDisabled = value;
    this.cdr.markForCheck();
  }

  /**
   * Toggle busy indicator
   * @param value
     */
  busy(value: boolean): void {
    this.isBusy = value;
    this.cdr.markForCheck();
  }

  highlight(blocks: Block[]): void {
    this.highlighted = blocks;
    this.cdr.markForCheck();
  }

  /**
   * Returns the ratio between the current SVG width (X) to the original width.
   * This is to go from current element width to original width.
   * @returns {number}
   */
  private get ratioX(): number {
    const e = this.boardElRef.nativeElement;
    return this.width / (e.clientWidth || e.parentNode.clientWidth);
  }
  /**
   * Returns the ratio between the current SVG width (Y) to the original width.
   * This is to go from current element width to original width.
   * Note: a board is a square so ratioX === ratioY, it's here for consistency
   * @returns {number}
   */
  private get ratioY(): number {
    const e = this.boardElRef.nativeElement;
    return this.height / (e.clientHeight || e.parentNode.clientHeight);
  }

  private registerDragAndDrop() {
    let svgElement: SVGSVGElement = this.boardElRef.nativeElement;

    let mousedown = Observable.fromEvent(svgElement, 'mousedown');
    let touchstart = Observable.fromEvent(svgElement, 'touchstart');

    let mousemove = Observable.fromEvent(svgElement, 'mousemove');
    let touchmove = Observable.fromEvent(svgElement, 'touchmove');
    // TODO: maybe catch mouseup on root component, get root via appRef boot event.
    let mouseup   = Observable.fromEvent(document, 'mouseup'); // catch drops everywhere
    let touchend   = Observable.fromEvent(document, 'touchend'); // catch drops everywhere

    let mousedrag = mousedown.flatMap((md: MouseEvent) => {
      if (this.isDisabled || !this.dragPiece) return []; // only track when piece is clicked, nothing else.

      // only drag when it's the piece turn.
      if (this.dragPiece.piece.color !== this.engine.turn()) return [];

      // since SVG is responsive 1 mouse px != 1 svg px
      // we get SVG px and we need a conversion ratio, from SVG to mouse px:
      const viewPortRatioX = this.ratioX,
            viewPortRatioY = this.ratioY;

      this.dragPiece.dragStart();

      let lastX = md.pageX;
      let lastY = md.pageY;

      // get all blocks that are a legal move for the current dragged piece
      // TODO: Move to Controller
      this.highlight(this.engine.moves(this.dragPiece.piece));

      // Calculate delta with mousemove until mouseup
      return mousemove.map((mm: MouseEvent) => {
        mm.preventDefault();

        let newScale = svgElement.currentScale,
          translation = svgElement.currentTranslate,
          x = (mm.pageX - translation.x) / newScale,
          y = (mm.pageY - translation.y) / newScale;

        let res =  {
          x: x - lastX,
          y: y - lastY
        };

        lastX = mm.pageX;
        lastY = mm.pageY;

        res.x *= viewPortRatioX;
        res.y *= viewPortRatioY;

        return res;
      }).takeUntil(mouseup); // stop moving when mouse is up
    });

    let touchdrag = touchstart.flatMap((md: TouchEvent) => {
      if (this.isDisabled) return []; // only track when piece is clicked, nothing else.
      if (md.touches.length < 1) return [];

      // Accurate piece selection won't do in mobile, we select a piece if it's block was touched.
      const rect = svgElement.getBoundingClientRect();
      let   lastX = md.touches[0].pageX - rect.left,
            lastY = md.touches[0].pageY - rect.top,
            dropBlockIndex = BaseBlock.pointToIndex(lastX * this.ratioX, lastY * this.ratioY);

      this.dragPiece = this.pieces.toArray().filter(p => p.piece.block.index === dropBlockIndex)[0];

      if (!this.dragPiece) return [];

      // only drag when it's the piece turn.
      if (this.dragPiece.piece.color !== this.engine.turn()) return [];


      // since SVG is responsive 1 mouse px != 1 svg px
      // we get SVG px and we need a conversion ratio, from SVG to mouse px:
      const viewPortRatioX = this.ratioX,
            viewPortRatioY = this.ratioY;

      this.dragPiece.dragStart();

      // get all blocks that are a legal move for the current dragged piece
      // TODO: Move to Controller
      this.highlight(this.engine.moves(this.dragPiece.piece));

      // Calculate delta with mousemove until mouseup
      return touchmove.map((mm: TouchEvent) => {
        mm.preventDefault();

        let x = mm.touches[0].pageX - rect.left,
            y = mm.touches[0].pageY - rect.top,
            newScale = svgElement.currentScale,
            translation = svgElement.currentTranslate;

        x = (x - translation.x) / newScale;
        y = (y - translation.y) / newScale;

        let res =  {
          x: x - lastX,
          y: y - lastY
        };

        lastX = mm.touches[0].pageX - rect.left;
        lastY = mm.touches[0].pageY - rect.top;

        res.x *= viewPortRatioX;
        res.y *= viewPortRatioY;
        return res;
      }).takeUntil(touchend); // stop moving when mouse is up
    });

    // Update coordinates of the dragged piece
    let subscription = mousedrag.subscribe(pos => pos && this.dragPiece.setCoordinates(pos.x, pos.y));
    this.rxWaste.push(subscription);

    subscription = touchdrag.subscribe(pos => pos && this.dragPiece.setCoordinates(pos.x, pos.y));
    this.rxWaste.push(subscription);

    // take action when a piece is dropped
    subscription = mouseup.subscribe(mu => this.dragPiece && this.dropPiece(mu));
    this.rxWaste.push(subscription);

    subscription = touchend.subscribe(mu => this.dragPiece && this.dropPiece(mu));
    this.rxWaste.push(subscription);
  }

  /**
   * A user made a move that requires a promotion, this is the place to diplay a prompt.
   * @returns {Promise<PieceType>}
   */
  askPromotionType(): Promise<PieceType> {
    return Promise.resolve(PieceType.QUEEN);
  }


  /**
   * Reflects a logical move on the board, this is a simple UI move operation, no logic
   * You can use this function to move UI elements so they will be illegal!
   * Note that moving a piece to an occupied block will remove the tenant from the UI.
   * @param piece
   */
  move(piece: Piece): void {
    const pieceCmp = this.pieces.toArray().filter(p => p.piece === piece)[0];

    if (pieceCmp) {
      const toBlockCmp = this.blocks.toArray()[piece.block.index];
      pieceCmp.block = toBlockCmp;
      pieceCmp.reset(150);
    } else if (this.engine.pieces.indexOf(piece) > -1) {
      // item in collection but not kicked in by CD
      // we need to let the VM turn end for CD to kick it.
      setTimeout( () => this.move(piece) );
    }
  }

  private dropPiece(mu) {
    // TODO: Clicks outside SVG will still yield an even with coordinates relative to the parent
    // of the SVG, this might resolve to a valid block!
    // need to have 2 observables for document and for SVG element and merge them to one. (SVG should preventDefault)
    // the document observables should emit value that this function can identify then cancel the drop.


    let x = mu.clientX, y = mu.clientY;
    if ( x === undefined || y === undefined ) {
      x = mu.changedTouches[0].clientX;
      y = mu.changedTouches[0].clientY;
    }

    const rect = this.boardElRef.nativeElement.getBoundingClientRect();
    x -= rect.left;
    y -= rect.top;

    const dropBlockIndex = BaseBlock.pointToIndex(x * this.ratioX, y * this.ratioY);
    const dropBlock = this.blocks.toArray()[dropBlockIndex];

    // take action only when user dropped on a block
    if (dropBlock) {
      this.ctrl.move(this.dragPiece.piece, dropBlock.block)
        .then(move => {
          if (move.invalid) {
            // the controller didn't do a move, we need to reset back to place.
            this.dragPiece.reset(150);
          } else { // the controller did the move
            // this.dragPiece.block = dropBlock;
            if (move.isCastlingMove()) {
              // castling is special, it moves a piece (rook) from a block not related to the action.
              // In most cases the logic change in the engine will propagate via angular's CD, not this case.
              // User clicked on the king's block and we also need to handle the rook's block.
              // On regular move's we pair block with pieces at the piece component on drag end, the
              // piece will trigger CDR internally for itself only, which is fine.
              // On any capture including en-passant we remove the piece from the logical piece array
              // which affect the QueryList and thus the dom elements.
              // However, on castling we don't remove the rook, we don't even change it's location (index)
              // in the array so nothing about the rook trigger it's piece CDR.
              // this means we need to run a sync operation
              // this will resync all block components with piece components.
              // TODO: Refactor, we know all piece's involved we can only change them instead of complete sweep.
              this.syncPiecesToBlocks();
            }
            log(move);
          }
          this.endDragAndDrop();
        });
    }
    else {
      this.endDragAndDrop();
    }
  }


  private endDragAndDrop() {
    this.dragPiece.dragEnd(); // let the piece set itself inside the block and trigger CD.
    this.dragPiece = undefined; // reset drag placeholders.
    this.highlighted = [];
  }

  /**
   * Clear all block/piece component pairing and re-pair them according to the current state of
   * the block/piece models.
   */
  private syncPiecesToBlocks() {
    const pieces = this.pieces.toArray(),
          blocks = this.blocks.toArray();

    blocks.forEach(b => {
      let found: boolean;
      for (let i = 0, len = pieces.length; i < len; i++) {
        if ( b.block === pieces[i].piece.block ) {
          found = true;
          pieces[i].block = b;
          pieces[i].reset(150);
          break;
        }
      }
      // when settings a block component on a piece the setter will also set the piece on a block.
      // i.e: piece.block = block will do block.piece = piece.
      // if we didn't find a piece (i.e the block is empty) we need to clear it)
      if (!found) b.piece = undefined;
    });
  }
}
