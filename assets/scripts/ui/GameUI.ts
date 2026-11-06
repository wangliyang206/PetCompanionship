/**
 * 运行时 UI 表现层（B3~B7）
 * - 场景没有 UI 节点，全部在运行时搭建：顶栏、食物柜、孵化倒计时、台词气泡、
 *   新手三选一、图鉴面板、破壳揭晓光效
 * - 交互统一走全局 input + 屏幕坐标命中测试（3D 宠物节点投影到 UI 坐标），
 *   不依赖碰撞体，也不依赖编辑器里搭 UI
 * - 文案全部来自 PetDefs 台词库，不含稀有度/物种暗示
 */

import {
  _decorator, Camera, Color, Component, director, EventTouch, Graphics, input,
  Input, Label, Layers, Node, tween, UIOpacity, Vec2, Vec3, view,
} from 'cc';
import { GameConfig } from '../core/GameConfig';
import { GameSave } from '../core/GameSave';
import { SceneAnchors } from '../core/SceneAnchors';
import { EggSystem } from '../egg/EggSystem';
import { EggSource, Stage, Rarity, Behavior } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { Collection } from '../collection/Collection';
import { Onboarding } from './Onboarding';
import { DialogBubble } from './DialogBubble';
import { PetBehavior } from '../pet/PetBehavior';
import { PetView } from '../pet/PetView';
import { TouchPet } from '../interaction/TouchPet';
import { DragFeed } from '../interaction/DragFeed';
import { PokePlay } from '../interaction/PokePlay';
import { DragPet } from '../interaction/DragPet';
import { ExploreSystem, ExploreResult, ExploreKind } from '../explore/ExploreSystem';
import { GrowthService } from '../pet/GrowthService';
import { PetPersonality } from '../pet/PetPersonality';
import { MissYouService } from '../core/MissYouService';
import { DebugTools } from '../core/DebugTools';
import { TimeService } from '../core/TimeService';
import { getSpecies } from '../pet/PetDefs';
import { PetState } from '../core/SaveData';
import { UI, button, circle, label, panel, uiNode } from './UiFactory';
import { EGG_STYLES, createEggNode, createEggPedestal, drawNestFront, drawNestPad, drawRevealCard, hashId } from './EggArt';
import { createOnboardingBackdrop } from './OnboardingBackdrop';

const { ccclass } = _decorator;

/** 命中半径（设计像素，按屏幕宽度换算） */
const HIT = {
  PET: 120,
  DISH: 62,
  SWIPE: 26,
  TAP: 18,
};

/** 三选一布局（设计像素，720×1280 基准） */
const EGG_CX = 224;
const EGG_CY = 74;

@ccclass('GameUI')
export class GameUI extends Component {

  private _w = 0;
  private _h = 0;
  private _cam: Camera | null = null;
  private _petView: PetView | null = null;

  private _foodLb: Label | null = null;
  private _dustLb: Label | null = null;
  private _eggPill: Node | null = null;
  private _eggTf: Node | null = null;
  private _eggText: Label | null = null;
  private _eggBar: Graphics | null = null;
  private _hint: Node | null = null;
  private _toast: Node | null = null;
  private _toastLb: Label | null = null;
  private _bubble: Node | null = null;
  private _bubbleLb: Label | null = null;
  private _dragDot: Node | null = null;
  private _onboard: Node | null = null;
  private _album: Node | null = null;
  private _missYouPill: Node | null = null;
  private _missYouLb: Label | null = null;
  private _recallBtn: Node | null = null;
  private _pawG: Graphics | null = null;
  private _pawPill: Node | null = null;
  private _exploreDlg: Node | null = null;
  private _explorePetId = '';
  private _devPanel: Node | null = null;
  private _dragPet: DragPet | null = null;
  private _dragMode = false;

  // T25：孵化场景视觉可读
  private _eggG: Graphics | null = null;        // 软垫 Graphics（环形 + 垫心）
  private _eggOverlay: Node | null = null;      // 2D 灵卵叠加层（覆盖 3D 灰模）
  private _nestFront: Node | null = null;       // 窝的前唇（画在灵卵之上，把蛋压进窝里）
  private _nestFrontG: Graphics | null = null;
  private _eggBarAtEgg = false;                  // 倒计时条是否跟随蛋位置

  // T28：点按 ready 蛋 → 破壳演出 → 「恭喜获得」宠物卡片
  private _hatchPerforming = false;
  private _reveal: Node | null = null;          // 恭喜卡片（模态，轻触关闭）
  private _pendingGreet = '';                    // 卡片关掉后再说的第一句问候

  private _toastTimer = 0;
  private _bubbleTimer = 0;
  private _petScreen = { x: 0, y: 0 };
  private _behaviorTimer = 0;
  private _progressTimer = 0;
  private _lastSadLineTs = 0;

  // 触摸状态
  private _target: '' | 'pet' | 'dish' | 'album' = '';
  private _startX = 0;
  private _startY = 0;
  private _downX = 0;
  private _downY = 0;
  private _moved = 0;
  private _pressTs = 0;
  private _lastPetTs = 0;
  private _lastEggTs = 0;

  onLoad(): void {
    this._w = view.getVisibleSize().width;
    this._h = view.getVisibleSize().height;

    const scene = director.getScene();
    this._cam = scene?.getChildByName('Main Camera')?.getComponent(Camera) ?? null;
    this._petView = scene?.getChildByName('PetAnchor')?.getComponent(PetView) ?? null;
    this._dragPet = this._petView ? new DragPet(this._petView) : null;

    this.buildHud();
    this.bindEvents();

    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

    this.refreshHud();
    this.refreshMissYou();
    if (GameSave.data && Onboarding.isFirstLaunch(GameSave.data)) {
      this.showOnboarding();
    } else {
      this.showGreeting();
      this.announceMissYou();
    }
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    Events.off(EventName.DialogRequest, this.onDialogRequest);
    Events.off(EventName.FoodChanged, this.onFoodChanged);
    Events.off(EventName.StardustChanged, this.onDustChanged);
    Events.off(EventName.PetInteracted, this.onInteracted);
    Events.off(EventName.ActivePetSwitched, this.onSwitch);
    Events.off(EventName.PetStageChanged, this.onStageChanged);
    Events.off(EventName.ExploreReturned, this.onExploreReturned);
    Events.off(EventName.MissYouToday, this.onMissYouToday);
    Events.off(EventName.PetBehaviorChanged, this.onBehaviorChanged);
  }

  // ===== 生命周期 =====

  update(dt: number): void {
    this.updatePetScreen();
    this.updateBubblePos();
    this.updateEggOverlay();
    this.updateEggPill();
    this.drawEggPad();
    this.updateToast(dt);
    this.updateBubbleTimer(dt);
    this.updateHold();
    this.updateBehavior(dt);
    this.updateProgress(dt);
    this.updateRecallBtn();
  }

  private updatePetScreen(): void {
    const view3d = this._petView;
    if (!this._cam || !view3d) return;
    const sp = this._cam.worldToScreen(view3d.displayWorldPos);
    const size = view.getVisibleSize();
    // worldToScreen 像素比例 → 归一化 → UI 坐标（居中坐标）
    const win = view.getVisibleSizeInPixel();
    const nx = win.width > 0 ? sp.x / win.width : 0.5;
    const ny = win.height > 0 ? sp.y / win.height : 0.5;
    this._petScreen.x = (nx - 0.5) * size.width;
    this._petScreen.y = (ny - 0.5) * size.height;
  }

  private updateEggPill(): void {
    const save = GameSave.data;
    if (!save || !this._eggPill) return;
    const ready = EggSystem.findReadyEggs(save)[0];
    const incubating = PokePlay.getIncubatingEgg(save);
    const egg = ready ?? incubating;
    if (!egg) {
      this._eggPill.active = false;
      return;
    }
    this._eggPill.active = true;
    const now = TimeService.safeNow(save.lastSeenTs);

    if (ready) {
      if (this._eggText) this._eggText.string = '可以破壳了';
      if (this._eggBar) this.redrawBar(this._eggBar, 1);
    } else {
      const total = (egg.source === EggSource.Starter ? GameConfig.EGG.STARTER_HATCH_MIN : GameConfig.EGG.NORMAL_HATCH_MIN) * 60_000;
      const remain = Math.max(0, egg.hatchesAt - now);
      const mm = Math.floor(remain / 60_000);
      const ss = Math.floor((remain % 60_000) / 1000);
      if (this._eggText) {
        this._eggText.string = `孵化中 ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      }
      if (this._eggBar) this.redrawBar(this._eggBar, total > 0 ? 1 - remain / total : 1);
    }

    // T25：倒计时条跟随蛋（PetAnchor 世界位置 → UI 投影 → 蛋下方 100px）
    if (this._cam && this._petView) {
      const wp = this._petView.displayWorldPos;
      const ui = SceneAnchors.worldToUi(this._cam, wp);
      this._eggPill.setPosition(ui.x, ui.y - 100, 0);
    }
  }

  private redrawBar(g: Graphics, ratio: number): void {
    const w = 300;
    const h = 14;
    g.clear();
    g.fillColor = new Color(232, 220, 203, 255);
    g.roundRect(-w / 2, -h / 2, w, h, h / 2);
    g.fill();
    const fillW = Math.max(0.001, w * Math.min(1, Math.max(0, ratio)));
    g.fillColor = UI.WARM;
    g.roundRect(-w / 2, -h / 2, fillW, h, h / 2);
    g.fill();
  }

  // ===== T25：孵化场景视觉 —— 2D 灵卵叠加 + 软垫 =====

  private _lastEggId = '';

  /** 2D 灵卵叠加层：用 EggArt 绘制的精美灵卵，覆盖 3D 灰色 GLB 蛋 */
  private updateEggOverlay(): void {
    if (!this._eggOverlay) return;
    const save = GameSave.data;
    if (!save || !this._cam || !this._petView) {
      this._eggOverlay.active = false;
      this._petView?.setModelVisible(true);
      return;
    }
    const ready = EggSystem.findReadyEggs(save)[0];
    const incubating = PokePlay.getIncubatingEgg(save);
    const egg = ready ?? incubating;
    if (!egg) {
      this._eggOverlay.active = false;
      this._lastEggId = '';
      this._petView.setModelVisible(true);
      return;
    }
    this._eggOverlay.active = true;
    // 2D 灵卵接管画面 → 藏掉 3D 灰模（否则灰模会从灵卵后面露出半圆，像蛋背后贴了块阴影）
    this._petView.setModelVisible(false);

    // 第一次出现这枚蛋时创建 2D 灵卵（有呼吸/星轨/光尘动效，只建一次）
    if (this._lastEggId !== egg.id || this._eggOverlay.children.length === 0) {
      this._lastEggId = egg.id;
      this._eggOverlay.removeAllChildren();
      const st = EGG_STYLES[hashId(egg.id) % EGG_STYLES.length];
      const node = createEggNode(egg.id, st);
      node.setParent(this._eggOverlay);
    }

    // 位置 = PetAnchor 世界坐标 → UI 投影（略上浮一点盖 3D 蛋）
    const wp = this._petView.displayWorldPos;
    const ui = SceneAnchors.worldToUi(this._cam, wp);
    this._eggOverlay.setPosition(ui.x, ui.y + 10, 0);
    // 缩放 0.5 让 2D 灵卵合适地盖在 3D 蛋上方
    this._eggOverlay.setScale(0.5, 0.5, 1);

    // ready 时闪白光提示可破壳
    if (ready) {
      const body = this._eggOverlay.getChildByName('EggBody');
      if (body) {
        // 已经在跑呼吸动效，额外加个 ready 闪烁光环
        const aura = this._eggOverlay.getChildByName('EggAura');
        if (aura) {
          const op = aura.getComponent(UIOpacity);
          if (op) tween(op).repeatForever(tween(op).to(0.6, { opacity: 255 }).to(0.6, { opacity: 120 })).start();
        }
      }
    }
  }

  /** 软垫造型：在 HOME 世界位置投影处画一个可读的"窝"（编织巢，见 EggArt.drawNestPad） */
  private _padKey = '';

  private drawEggPad(): void {
    if (!this._eggG || !this._cam) return;
    const home = SceneAnchors.homePosition();
    const ui = SceneAnchors.worldToUi(this._cam, home);
    const hasEgg = !!this._eggOverlay?.active;
    // 巢是静态的：位置/状态没变就不重画（编织纹有近百条描边，每帧重建在低端机上很贵）
    const key = `${ui.x.toFixed(1)},${ui.y.toFixed(1)},${hasEgg ? 1 : 0}`;
    if (key === this._padKey) return;
    this._padKey = key;

    const g = this._eggG;
    g.clear();
    g.node.setPosition(ui.x, ui.y - 12, 0);
    drawNestPad(g);

    // 前唇只在有蛋时出现：蛋的下缘要被它压住，蛋才像坐在窝里
    if (this._nestFront) {
      this._nestFront.active = hasEgg;
      this._nestFront.setPosition(ui.x, ui.y - 12, 0);
      if (this._nestFrontG) {
        this._nestFrontG.clear();
        if (hasEgg) drawNestFront(this._nestFrontG);
      }
    }
  }

  private updateToast(dt: number): void {
    if (!this._toast || !this._toast.active) return;
    this._toastTimer -= dt;
    if (this._toastTimer <= 0) this._toast.active = false;
  }

  private updateBubbleTimer(dt: number): void {
    if (!this._bubble || !this._bubble.active) return;
    this._bubbleTimer -= dt;
    if (this._bubbleTimer <= 0) {
      this._bubble.active = false;
      DialogBubble.next();
    }
  }

  private updateBubblePos(): void {
    if (!this._bubble || !this._bubble.active) return;
    const x = Math.max(-this._w / 2 + 230, Math.min(this._w / 2 - 230, this._petScreen.x));
    const y = Math.min(this._h / 2 - 140, this._petScreen.y + 190);
    this._bubble.setPosition(x, y, 0);
  }

  /** 长按孵化中的蛋：每 450ms 减 2 分钟（ready 蛋改为点按直接破壳，见 T28） */
  private updateHold(): void {
    if (this._target !== 'pet' || this._moved > HIT.TAP) return;
    if (this._hatchPerforming) return; // 演出进行中，忽略触摸
    const save = GameSave.data;
    if (!save) return;

    const incubating = PokePlay.getIncubatingEgg(save);

    // incubating 蛋：每 0.5s 缩短 2 分钟
    if (incubating) {
      const now = Date.now();
      if (now - this._pressTs < 500) return;
      if (now - this._lastEggTs < 450) return;
      this._lastEggTs = now;
      const reduce = PokePlay.longPressEgg(save, incubating);
      if (reduce > 0) {
        this.showToast(`蛋壳震了一下（-${reduce / 60_000} 分钟）`);
        GameSave.markDirty();
      }
    }
  }

  /** T6：每 30 秒重算行为；T16：切到 Sad 时补一句失落台词（节流） */
  private updateBehavior(dt: number): void {
    const save = GameSave.data;
    if (!save) return;
    const pet = Collection.getActivePet(save);
    if (!pet) return;
    this._behaviorTimer -= dt;
    if (this._behaviorTimer > 0) return;
    this._behaviorTimer = 30;
    PetBehavior.refresh(save, pet);
  }

  /** T16：爪印陪伴进度（无数字），蛋期沿用孵化条 */
  private updateProgress(dt: number): void {
    if (!this._pawPill || !this._pawG) return;
    this._progressTimer -= dt;
    if (this._progressTimer > 0) return;
    this._progressTimer = 0.4;

    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet || pet.stage === Stage.Egg) {
      this._pawPill.active = false;
      return;
    }
    this._pawPill.active = true;
    this.drawPaws(GrowthService.stageProgress(save, pet));
  }

  private drawPaws(ratio: number): void {
    const g = this._pawG;
    if (!g) return;
    g.clear();
    const n = 8;
    const gap = 34;
    const total = (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const x = -total / 2 + i * gap;
      const lit = ratio * n >= i + 0.15;
      this.drawOnePaw(g, x, 0, lit);
    }
  }

  private drawOnePaw(g: Graphics, x: number, y: number, lit: boolean): void {
    g.fillColor = lit ? UI.WARM : new Color(196, 184, 166, 255);
    // 掌垫
    g.circle(x, y - 4, 6.5);
    g.fill();
    // 三个脚趾
    g.circle(x - 8, y + 5, 2.8);
    g.circle(x, y + 8, 2.8);
    g.circle(x + 8, y + 5, 2.8);
    g.fill();
  }

  /** 有宠物在探索时显示召回按钮 */
  private updateRecallBtn(): void {
    if (!this._recallBtn) return;
    const save = GameSave.data;
    this._recallBtn.active = !!save && ExploreSystem.anyExploring(save);
  }

  private toLocal(e: EventTouch): { x: number; y: number } {
    const p = e.getUILocation();
    return { x: p.x - this._w / 2, y: p.y - this._h / 2 };
  }

  private onTouchStart = (e: EventTouch): void => {
    const { x, y } = this.toLocal(e);

    // 恭喜卡片是模态：任意一点关闭，不透传给场景
    if (this._reveal && this._reveal.active) {
      this.closeReveal();
      return;
    }
    this._startX = x;
    this._startY = y;
    this._downX = x;
    this._downY = y;
    this._moved = 0;
    this._pressTs = Date.now();
    this._target = '';

    if (this._exploreDlg && this._exploreDlg.active) {
      this.tapExploreDialog(x, y);
      return;
    }
    if (this._onboard && this._onboard.active) {
      this.tapOnboarding(x, y);
      return;
    }
    if (this._album && this._album.active) {
      this.tapAlbum(x, y);
      return;
    }

    // 召回（有宠物在外时）
    const recall = this.recallPos();
    if (this._recallBtn && this._recallBtn.active &&
        Math.abs(x - recall.x) <= 72 && Math.abs(y - recall.y) <= 32) {
      this.recallExploring();
      return;
    }

    // 调试面板（?dev=1）
    if (this._devPanel && this._devPanel.active) {
      const idx = this.hitDevButton(x, y);
      if (idx >= 0) {
        this.runDev(idx);
        return;
      }
    }

    const albumBtn = this.albumButtonPos();
    if (Math.abs(x - albumBtn.x) <= 80 && Math.abs(y - albumBtn.y) <= 36) {
      this._target = 'album';
      this.openAlbum();
      return;
    }

    const dish = this.dishPos();
    if (Math.hypot(x - dish.x, y - dish.y) <= HIT.DISH) {
      this._target = 'dish';
      return;
    }

    if (this.hitPet(x, y)) {
      this._target = 'pet';
      return;
    }
  };

  private onTouchMove = (e: EventTouch): void => {
    const { x, y } = this.toLocal(e);
    this._moved += Math.hypot(x - this._startX, y - this._startY);
    this._startX = x;
    this._startY = y;

    // T22：拖动宠物（按住 ≥HOLD_MS 后移动）
    if (this._dragMode) {
      this._dragPet?.move(x, y);
      return;
    }
    if (this._target === 'pet') {
      const total = this.movedSinceStart(x, y);
      const held = Date.now() - this._pressTs;
      if (total > 40 && held >= GameConfig.DRAG.HOLD_MS && this._dragPet) {
        if (this._dragPet.begin(this._downX, this._downY)) {
          this._dragMode = true;
          this.hideDragDot();
          this._dragPet.move(x, y);
          return;
        }
      }
      if (this._moved > HIT.SWIPE) {
        this.petSwipe();
        return;
      }
    }
    if (this._target === 'dish') {
      this.moveDragDot(x, y);
    }
  };

  private onTouchEnd = (e: EventTouch): void => {
    const { x, y } = this.toLocal(e);
    if (this._dragMode) {
      this._dragMode = false;
      this._target = '';
      this.hideDragDot();
      this.finishPetDrag(x, y);
      return;
    }
    const target = this._target;
    this._target = '';
    this.hideDragDot();
    if (target === '') return;

    if (target === 'dish') {
      if (this.movedSinceStart(x, y) > HIT.TAP) {
        if (this.hitPet(x, y)) this.feed();
        else this.showToast('把食物拖到它嘴边');
      } else {
        this.showToast('从食物柜拖一条小鱼干给它');
      }
      return;
    }

    if (target === 'pet') {
      // 演出进行中不再触发 poke / 抚摸
      if (this._hatchPerforming) return;
      if (this._moved > HIT.SWIPE) return; // 已按抚摸处理
      if (Date.now() - this._pressTs >= 500 && this.heldEgg()) return; // 长按摸蛋
      this.poke();
    }
  };

  private movedSinceStart(x: number, y: number): number {
    return Math.hypot(x - this._downX, y - this._downY);
  }

  private hitPet(x: number, y: number): boolean {
    const r = HIT.PET * (this._w / 720);
    return Math.hypot(x - this._petScreen.x, y - this._petScreen.y) <= r;
  }

  private heldEgg(): boolean {
    const save = GameSave.data;
    if (!save) return false;
    return !!PokePlay.getIncubatingEgg(save);
  }

  // ===== 拖动宠物 / 探索派出（T22 / T12）=====

  private finishPetDrag(x: number, y: number): void {
    const drag = this._dragPet;
    if (!drag) return;
    const target = drag.end(x, y);
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;

    // 窝外（没有落点）或窝外角落：委屈回望后自行踱回，不惩罚
    if (!target || target === 'Corner') {
      this._petView?.playReaction('sad', 1.6);
      this.say('……（委屈地看了你一眼，自己踱回小窝）');
      drag.walkHome();
      return;
    }

    // 门口：进入探索派发
    if (target === 'Doorway') {
      if (save && pet && ExploreSystem.canDispatch(save, pet)) {
        drag.resumeWander(1.0);
        this.openExploreDialog(pet);
      } else if (pet && (pet.stage === Stage.Adult || pet.stage === Stage.Final)) {
        this.showToast('它已经在外面了');
        drag.walkHome();
      } else {
        this.showToast('长大一点才可以出门探险');
        drag.walkHome();
      }
      return;
    }

    switch (target) {
      case 'SleepPad':
        this._petView?.playReaction('satisfy', 1.2);
        this.say('软软的垫子，舒服得蜷成一团');
        break;
      case 'FoodBowl':
        this._petView?.playReaction('excited', 1.0);
        this.say('食物！是你给我留的吗？');
        break;
      case 'PlayPile':
        this._petView?.playReaction('play', 1.0);
        this.say('这个玩具是我的啦');
        break;
      case 'Window':
        this._petView?.playReaction('satisfy', 1.0);
        this.say('窗边晒太阳最舒服了');
        break;
    }
    drag.resumeWander(1.4);
  }

  private openExploreDialog(pet: import('../core/SaveData').PetState): void {
    if (this._exploreDlg) return;
    const w = this._w;
    const h = this._h;
    const root = uiNode('ExploreDialog', w, h);
    root.setParent(this.node);
    root.setPosition(0, 0, 0);
    this._exploreDlg = root;
    this._explorePetId = pet.id;

    const mask = panel('Mask', w, h, UI.MASK, 0);
    mask.setParent(root);

    const bg = panel('Bg', 540, 470, UI.BG_SOLID, 24);
    bg.setParent(root);
    bg.setPosition(0, 0);

    const title = label('Title', '要出门探险吗？', 28, UI.TEXT, 460, 44);
    title.setParent(bg);
    title.setPosition(0, 176);

    const sub = label('Sub', '它会在外面待一阵子，回来也许带些东西', 17, UI.TEXT_LIGHT, 460, 30);
    sub.setParent(bg);
    sub.setPosition(0, 138);

    const shortBtn = button('ShortBtn', '短途 · 约 2 小时', 400, 64, UI.CARD, UI.TEXT, 22);
    shortBtn.setParent(bg);
    shortBtn.setPosition(0, 50);

    const longBtn = button('LongBtn', '远征 · 约 8 小时', 400, 64, UI.WARM, new Color(255, 255, 255, 255), 22);
    longBtn.setParent(bg);
    longBtn.setPosition(0, -36);

    const cancel = label('Cancel', '先不去了', 18, UI.TEXT_LIGHT, 300, 40);
    cancel.setParent(bg);
    cancel.setPosition(0, -140);
  }

  private tapExploreDialog(x: number, y: number): void {
    if (!this._exploreDlg) return;
    if (Math.abs(x) <= 220 && Math.abs(y - 50) <= 34) {
      this.dispatchExplore('short');
      return;
    }
    if (Math.abs(x) <= 220 && Math.abs(y + 36) <= 34) {
      this.dispatchExplore('long');
      return;
    }
    if (Math.abs(x) <= 150 && Math.abs(y + 140) <= 24) {
      this.closeExploreDialog();
    }
  }

  private dispatchExplore(kind: ExploreKind): void {
    const save = GameSave.data;
    if (!save) return;
    const pet = save.pets.find(p => p.id === this._explorePetId);
    if (!pet) {
      this.closeExploreDialog();
      return;
    }
    if (!ExploreSystem.canDispatch(save, pet)) {
      this.showToast('它现在还不能出门');
      this.closeExploreDialog();
      return;
    }
    ExploreSystem.dispatch(save, pet, kind);
    GameSave.markDirty();
    this.closeExploreDialog(false);
    this.say(kind === 'short' ? '我出去转转，很快就回来' : '我出远门啦，等我回来');
    this.showToast(kind === 'short' ? '短途探险开始（约 2 小时）' : '远征开始（约 8 小时）');
    this.refreshHud();
  }

  private closeExploreDialog(returnHome: boolean = true): void {
    this._exploreDlg?.destroy();
    this._exploreDlg = null;
    this._explorePetId = '';
    if (returnHome) this._dragPet?.cancel();
  }

  private recallExploring(): void {
    const save = GameSave.data;
    if (!save) return;
    const pet = ExploreSystem.exploringPets(save)[0];
    if (!pet) {
      this.showToast('没有在外面的小家伙');
      return;
    }
    ExploreSystem.recall(save, pet);
    GameSave.markDirty();
    this.refreshHud();
  }

  private recallPos(): { x: number; y: number } {
    return { x: this._w / 2 - 92, y: this._h / 2 - 146 };
  }

  // ===== 调试面板（?dev=1，T11/T13 验收）=====

  private devPos(i: number): { x: number; y: number } {
    return { x: this._w / 2 - 86, y: this._h / 2 - 220 - i * 62 };
  }

  private hitDevButton(x: number, y: number): number {
    for (let i = 0; i < 3; i++) {
      const p = this.devPos(i);
      if (Math.abs(x - p.x) <= 76 && Math.abs(y - p.y) <= 28) return i;
    }
    return -1;
  }

  private runDev(idx: number): void {
    const save = GameSave.data;
    if (!save) return;
    if (idx === 0) {
      DebugTools.fastForwardGrowth(save, 24);
      this.showToast('成长快进 24 小时');
    } else if (idx === 1) {
      DebugTools.fastForwardDays(save, 1);
      this.showToast('快进 1 天');
    } else {
      DebugTools.fastForwardDays(save, 7);
      this.showToast('快进 7 天');
      console.log('[Dev] 7天后 食物=', save.food, '蛋=', save.eggs.length, '星尘=', save.stardust);
    }
    this.refreshHud();
  }

  // ===== 互动动作 =====

  private petSwipe(): void {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return;
    const now = Date.now();
    if (now - this._lastPetTs < 320) return;
    this._lastPetTs = now;
    // 长风（胆小）：久别后第一次互动先炸毛（T14）
    const special = PetPersonality.firstResponse(save, pet);
    TouchPet.perform(save, pet);
    GameSave.markDirty();
    PetBehavior.refresh(save, pet);
    this.say(special ?? PetBehavior.pickInteractLine(save, pet, 'pet'));
  }

  private poke(): void {
    const save = GameSave.data;
    if (!save) return;
    const ready = EggSystem.findReadyEggs(save)[0];
    if (ready) {
      // T28：点一下就破壳，不再要求长按（长按门槛实测挫败感强）
      this.runHatchPerformance(ready);
      return;
    }
    const pet = Collection.getActivePet(save);
    if (pet) {
      PokePlay.poke(save, pet);
      GameSave.markDirty();
      PetBehavior.refresh(save, pet);
      this.say(PetBehavior.pickInteractLine(save, pet, 'play'));
      return;
    }
    // 窝里没有宠物但有待孵的蛋：轻拍蛋壳，提示长按加速（不泄露物种/稀有度）
    if (PokePlay.getIncubatingEgg(save)) {
      this.showToast('蛋壳里有动静，长按可以帮它一把');
      return;
    }
    this.showToast('窝里还空着');
  }

  private feed(): void {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) {
      this.showToast('还没有可以喂的小家伙');
      return;
    }
    if (DragFeed.perform(save, pet)) {
      GameSave.markDirty();
      PetBehavior.refresh(save, pet);
      this.say(PetBehavior.pickInteractLine(save, pet, 'feed'));
    } else {
      this.showToast('食物柜空了，明天再来');
    }
  }

  private hatch(egg: import('../core/SaveData').EggState): void {
    const save = GameSave.data;
    if (!save) return;
    const res = EggSystem.hatchEgg(save, egg);
    GameSave.markDirty();
    if (res.pet) {
      const pet = res.pet;
      // 演出已跑完，这里只处理新宠物的问候台词（celebrate 演出在 runHatchPerformance 里提前跑了）
      const line = PetBehavior.pickGreetingLine(save, pet);
      // T27：用"我出来啦！"覆盖默认问候，契合破壳时刻的仪式感
      DialogBubble.show('我出来啦！');
      // 问候不抢在卡片之前说：等卡片关掉再开口
      this._pendingGreet = line;
      // T28：庆祝演出结束后弹出「恭喜获得」卡片（先让演出亮完）
      this.scheduleOnce(() => this.showRevealCard(pet), 1.6);
    } else {
      DialogBubble.show(`重复的灵卵化作 ${res.dupStardust} 星尘`);
    }
    this.refreshHud();
  }

  /**
   * T27 破壳演出（所有稀有度都有基础演出；稀有度叠加放射光）
   * 序列：shake → flash白光 → pieces飞散 → hatch → petView celebrate → 星尘粒子 → 台词
   * 演出结束才调 EggSystem.hatchEgg（离线补演出：离线到点的蛋保持 ready 状态等玩家长按）
   */
  private runHatchPerformance(egg: import('../core/SaveData').EggState): void {
    if (this._hatchPerforming) return;
    this._hatchPerforming = true;
    const save = GameSave.data;
    if (!save) { this._hatchPerforming = false; return; }

    // 从蛋内物种取稀有度（破壳揭晓时刻）
    const rfinal: Rarity = getSpecies(egg.speciesId)?.rarity ?? Rarity.Common;

    // ① shake：2D 灵卵 ±8° 抖动 6 次（总计 ~0.48s）
    const overlay = this._eggOverlay;
    const doShake = () => {
      if (!overlay) return;
      tween(overlay)
        .by(0.08, { eulerAngles: new Vec3(0, 0, 8) })
        .by(0.08, { eulerAngles: new Vec3(0, 0, -16) })
        .by(0.08, { eulerAngles: new Vec3(0, 0, 16) })
        .by(0.08, { eulerAngles: new Vec3(0, 0, -16) })
        .by(0.08, { eulerAngles: new Vec3(0, 0, 16) })
        .by(0.08, { eulerAngles: new Vec3(0, 0, -8) })
        .to(0.05, { eulerAngles: new Vec3(0, 0, 0) })
        .start();
    };

    // ② flash：全屏白光（opacity 220→0，0.35s）
    const doFlash = () => {
      const flash = new Node('HatchFlash');
      flash.layer = Layers.Enum.UI_2D;
      flash.setParent(this.node!);
      flash.setPosition(0, 0, 0);
      const tf = flash.addComponent(UIOpacity);
      tf.opacity = 235;
      const w = this._w, h = this._h;
      const g = flash.addComponent(Graphics);
      g.fillColor = new Color(255, 255, 255, 255);
      g.rect(-w / 2, -h / 2, w, h);
      g.fill();
      tween(tf).to(0.35, { opacity: 0 }).call(() => flash.destroy()).start();
    };

    // ③ pieces：4 片蛋壳从中心向外飞 + 淡出（0.8s）
    const doPieces = () => {
      if (!overlay) return;
      const parts: Node[] = [];
      for (let i = 0; i < 6; i++) {
        const p = new Node('Piece' + i);
        p.layer = Layers.Enum.UI_2D;
        p.setParent(overlay);
        const op = p.addComponent(UIOpacity);
        op.opacity = 255;
        const g = p.addComponent(Graphics);
        g.fillColor = new Color(230, 200, 150, 255);
        g.strokeColor = new Color(120, 80, 40, 200);
        g.lineWidth = 1.5;
        // 画一片蛋壳碎块（扇形）
        g.moveTo(0, 0);
        g.lineTo(18 + Math.random() * 10, -8 + Math.random() * 16);
        g.lineTo(-4 + Math.random() * 10, 22 + Math.random() * 8);
        g.close();
        g.fill();
        g.stroke();
        parts.push(p);
      }
      parts.forEach((p, i) => {
        const a = (i / parts.length) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 80 + Math.random() * 60;
        tween(p)
          .to(0.75, {
            position: new Vec3(Math.cos(a) * dist, Math.sin(a) * dist + 20, 0),
            eulerAngles: new Vec3(0, 0, (Math.random() - 0.5) * 360),
          })
          .start();
        const op = p.getComponent(UIOpacity);
        if (op) tween(op).delay(0.35).to(0.4, { opacity: 0 }).call(() => p.destroy()).start();
      });
      // 同时把灵卵本体也放大消失（0.4s）
      const op = overlay.addComponent(UIOpacity);
      op.opacity = 255;
      tween(overlay)
        .to(0.4, { scale: new Vec3(0.75, 0.75, 1) })
        .start();
      tween(op)
        .delay(0.15)
        .to(0.25, { opacity: 0 })
        .call(() => { overlay.active = false; })
        .start();
    };

    // ④ 稀有度放射光（从蛋位置向外扩散，≥1.5s，Common 无）
    const doBeam = () => {
      const key = (rfinal.charAt(0).toUpperCase() + rfinal.slice(1)) as keyof typeof GameConfig.RARITY_FX;
      const hex = (GameConfig.RARITY_FX as Record<string, string | null>)[key];
      if (!hex) return; // Common 无放射光，跳过
      const color = new Color();
      Color.fromHEX(color, hex);
      const save2 = GameSave.data;
      const petView = this._petView;
      if (!this._cam || !petView) return;
      const wp = petView.displayWorldPos;
      const ui = SceneAnchors.worldToUi(this._cam, wp);

      const beam = new Node('HatchBeam');
      beam.layer = Layers.Enum.UI_2D;
      beam.setParent(this.node!);
      beam.setPosition(ui.x, ui.y + 22, 0);
      const op = beam.addComponent(UIOpacity);
      op.opacity = 255;
      const g = beam.addComponent(Graphics);
      // 画放射光（8 道光柱从中心向外）
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const len = 220;
        g.fillColor = new Color(color.r, color.g, color.b, 180);
        g.moveTo(Math.cos(a - 0.12) * 16, Math.sin(a - 0.12) * 16);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        g.lineTo(Math.cos(a + 0.12) * 16, Math.sin(a + 0.12) * 16);
        g.close();
        g.fill();
      }
      // 中心光球
      g.fillColor = new Color(color.r, color.g, color.b, 255);
      g.circle(0, 0, 22);
      g.fill();
      const whiteOp = new Node('BeamWhite');
      whiteOp.layer = Layers.Enum.UI_2D;
      whiteOp.setParent(beam);
      const wOp = whiteOp.addComponent(UIOpacity);
      wOp.opacity = 255;
      const wg = whiteOp.addComponent(Graphics);
      wg.fillColor = new Color(255, 255, 255, 230);
      wg.circle(0, 0, 14);
      wg.fill();

      tween(beam)
        .to(1.5, { scale: new Vec3(1.6, 1.6, 1) })
        .start();
      tween(op).delay(0.8).to(0.7, { opacity: 0 }).call(() => beam.destroy()).start();
      tween(wOp).to(0.5, { opacity: 0 }).start();
    };

    // ⑤ starDust：18 颗星尘粒子从蛋位置向外飞 + 淡出
    const doStardust = () => {
      if (!this._cam || !this._petView) return;
      const wp = this._petView.displayWorldPos;
      const ui = SceneAnchors.worldToUi(this._cam, wp);
      for (let i = 0; i < 18; i++) {
        const p = new Node('StarDust' + i);
        p.layer = Layers.Enum.UI_2D;
        p.setParent(this.node!);
        p.setPosition(ui.x + (Math.random() - 0.5) * 40, ui.y + 22 + (Math.random() - 0.5) * 40, 0);
        const op = p.addComponent(UIOpacity);
        op.opacity = 200 + Math.random() * 55;
        const g = p.addComponent(Graphics);
        g.fillColor = new Color(255, 220, 150, 255);
        const r = 2 + Math.random() * 2;
        g.circle(0, 0, r);
        g.fill();
        g.fillColor = new Color(255, 255, 255, 255);
        g.circle(0, 0, r * 0.4);
        g.fill();
        const a = Math.random() * Math.PI * 2;
        const dist = 100 + Math.random() * 140;
        const dur = 1.2 + Math.random() * 0.6;
        tween(p).to(dur, {
          position: new Vec3(p.position.x + Math.cos(a) * dist, p.position.y + Math.sin(a) * dist + 60, 0),
        }).start();
        tween(op).delay(0.4 + Math.random() * 0.3).to(dur - 0.4, { opacity: 0 }).call(() => p.destroy()).start();
      }
    };

    // 序列：shake(0.48s) → flash → pieces+beam+starDust 同时 → hatch → celebrate
    doShake();
    this.scheduleOnce(() => doFlash(), 0.44);
    this.scheduleOnce(() => {
      doPieces();
      doBeam();
      doStardust();
      // 演出中段才 hatch：这样 PetView 换模型时用户正看着 pieces 飞散，3D 幼崽自然登场
      const saveNow = GameSave.data;
      if (saveNow) this.hatch(egg);
    }, 0.52);
    this.scheduleOnce(() => {
      // hatch 完 PetView 刷新模型后，给 0.3s 让新模型加载 → celebrate 演出
      this._petView?.playReaction('celebrate', 1.4);
      this._hatchPerforming = false;
    }, 0.95);
  }

  // ===== T28：破壳后的「恭喜获得」宠物卡片 =====

  private static readonly RARITY_LABEL: Record<string, string> = {
    common: '普通', rare: '稀有', epic: '史诗', legend: '传说',
  };
  private static readonly XI_LABEL: Record<string, string> = {
    mao: '毛虫系', yu: '羽虫系', lin: '鳞虫系', jie: '介虫系', luo: '倮虫系',
  };

  /** 破壳揭晓：弹出「恭喜获得 ✕✕」卡片（模态，轻触任意处关闭） */
  private showRevealCard(pet: PetState): void {
    if (this._reveal || !this._w) return;
    const species = getSpecies(pet.speciesId);
    if (!species) return;
    const w = this._w;
    const h = this._h;

    const root = uiNode('Reveal', w, h);
    root.setParent(this.node);
    root.setPosition(0, 0, 0);
    const rootOp = root.addComponent(UIOpacity);
    rootOp.opacity = 255;
    this._reveal = root;

    // 半透遮罩（渐入）
    const mask = panel('RevealMask', w, h, UI.MASK, 0);
    mask.setParent(root);
    const mOp = mask.addComponent(UIOpacity);
    mOp.opacity = 0;
    tween(mOp).to(0.25, { opacity: 255 }).start();

    // 稀有度主题色（RARITY_FX 里 Common 为 null → 用暖金兜底）
    const cap = species.rarity.charAt(0).toUpperCase() + species.rarity.slice(1);
    const fxHex = (GameConfig.RARITY_FX as Record<string, string | null>)[cap] ?? '#D9A066';
    const rarColor = new Color();
    Color.fromHEX(rarColor, fxHex);
    const theme = new Color();
    Color.fromHEX(theme, species.themeColor);

    // 卡片本体
    const card = uiNode('RevealCard', 560, 660);
    card.setParent(root);
    card.setPosition(0, 20, 0);
    card.setScale(0.55, 0.55, 1);
    const g = card.addComponent(Graphics);
    drawRevealCard(g, { rar: rarColor, theme });

    // 标题 / 名字 / 标签 / 台词 / 装饰 / 提示
    const title = label('RevealTitle', '恭 喜 获 得 新 伙 伴', 30, new Color(255, 250, 240, 255), 500, 40);
    title.setParent(card);
    title.setPosition(0, 286);

    const name = label('RevealName', `「${species.name}」`, 56, UI.TEXT, 500, 76);
    name.setParent(card);
    name.setPosition(0, 168);

    // 标签底由 drawRevealCard 画，这里只放文字；文字用压深一档的同色系（纯稀有度色放在浅底上对比不足）
    const deepRar = new Color(Math.round(rarColor.r * 0.72), Math.round(rarColor.g * 0.72), Math.round(rarColor.b * 0.72), 255);
    const deepTheme = new Color(Math.round(theme.r * 0.62), Math.round(theme.g * 0.62), Math.round(theme.b * 0.62), 255);
    const rarLabel = label('RevealRar', GameUI.RARITY_LABEL[species.rarity] ?? '', 24, deepRar, 160, 54);
    rarLabel.setParent(card);
    rarLabel.setPosition(-116, 89);
    const xiLabel = label('RevealXi', GameUI.XI_LABEL[species.xi] ?? '', 24, deepTheme, 160, 54);
    xiLabel.setParent(card);
    xiLabel.setPosition(116, 89);

    // 初见台词：从它的开心台词里挑一句
    const quotes = species.lines.happy;
    const quote = quotes.length ? quotes[Math.floor(Math.random() * quotes.length)] : '……';
    const quoteLb = label('RevealQuote', `「${quote}」`, 24, UI.TEXT_LIGHT, 480, 60);
    quoteLb.setParent(card);
    quoteLb.setPosition(0, -108);

    // 分隔装饰：细线 + 菱形
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 217, 168, 70);
    g.moveTo(-150, -108); g.lineTo(-26, -108); g.stroke();
    g.moveTo(26, -108); g.lineTo(150, -108); g.stroke();
    g.fillColor = new Color(255, 217, 168, 130);
    g.moveTo(-26, -103); g.lineTo(-21, -108); g.lineTo(-26, -113); g.lineTo(-31, -108); g.close(); g.fill();
    g.moveTo(26, -103); g.lineTo(31, -108); g.lineTo(26, -113); g.lineTo(21, -108); g.close(); g.fill();

    const nth = GameSave.data?.pets.length ?? 1;
    const home = label('RevealHome', `它是你收养的第 ${nth} 位伙伴`, 21, UI.TEXT_LIGHT, 400, 32);
    home.setParent(card);
    home.setPosition(0, -212);

    const hint = label('RevealHint', '轻 触 任 意 处 继 续', 16, new Color(150, 132, 112, 130), 400, 28);
    hint.setParent(card);
    hint.setPosition(0, -282);

    // 入场：遮罩渐入 + 卡片回弹放大
    const cOp = card.addComponent(UIOpacity);
    cOp.opacity = 0;
    tween(cOp).to(0.2, { opacity: 255 }).start();
    tween(card).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();

  }

  private closeReveal(): void {
    const r = this._reveal;
    if (!r) return;
    this._reveal = null;
    const op = r.getComponent(UIOpacity);
    if (op) {
      tween(op).to(0.16, { opacity: 0 }).call(() => r.destroy()).start();
    } else {
      r.destroy();
    }
    // 卡片关掉，宠物才开口（否则台词会被卡片遮住）
    if (this._pendingGreet) {
      const line = this._pendingGreet;
      this._pendingGreet = '';
      this.scheduleOnce(() => DialogBubble.show(line), 0.25);
    }
  }

  private say(text: string): void {
    DialogBubble.show(text);
  }

  // ===== HUD =====

  private buildHud(): void {
    const w = this._w;
    const h = this._h;

    // T25：软垫（窝）造型 Graphics —— 挂在 UI_2D 层，每帧把 HOME 世界位置投影过来画
    const eggPad = uiNode('EggPad', 400, 300);
    eggPad.setParent(this.node);
    this._eggG = eggPad.addComponent(Graphics);

    // T25：2D 灵卵叠加层 —— 覆盖 3D 灰模（UI_2D 永远在上）
    this._eggOverlay = uiNode('EggOverlay', 260, 280);
    this._eggOverlay.setParent(this.node);
    this._eggOverlay.active = false;

    // T25：窝的前唇 —— 必须排在灵卵之后，压在蛋的下缘上，蛋才像「坐」在窝里
    this._nestFront = uiNode('NestFront', 400, 300);
    this._nestFront.setParent(this.node);
    this._nestFrontG = this._nestFront.addComponent(Graphics);
    this._nestFront.active = false;

    // 顶栏：食物 / 星尘 / 图鉴
    const foodPill = panel('FoodPill', 170, 64, UI.BG, 32);
    foodPill.setParent(this.node);
    foodPill.setPosition(-w / 2 + 96, h / 2 - 70);
    this._foodLb = this.addLabelInside(foodPill, '食物 0', 22, UI.TEXT, 170, 64);

    const dustPill = panel('DustPill', 170, 64, UI.BG, 32);
    dustPill.setParent(this.node);
    dustPill.setPosition(w / 2 - 280, h / 2 - 70);
    this._dustLb = this.addLabelInside(dustPill, '星尘 0', 22, UI.TEXT, 170, 64);

    const albumBtn = button('AlbumBtn', '图鉴', 150, 64, UI.WARM, new Color(255, 255, 255, 255), 24);
    albumBtn.setParent(this.node);
    albumBtn.setPosition(w / 2 - 92, h / 2 - 70);

    // 食物柜
    const dish = circle('FoodDish', 52, UI.BG);
    dish.setParent(this.node);
    dish.setPosition(-w / 2 + 88, -h / 2 + 130);
    const dishLb = label('FoodDishLabel', '食物柜', 20, UI.TEXT_LIGHT, 120, 30);
    dishLb.setParent(this.node);
    dishLb.setPosition(-w / 2 + 88, -h / 2 + 52);
    const dishIcon = label('FoodDishIcon', '小鱼干', 20, UI.WARM_DARK, 110, 30);
    dishIcon.setParent(dish);
    dishIcon.setPosition(0, 0, 0);

    // 孵化倒计时 —— 位置跟随蛋（由 updateEggPill 动态 setPosition）
    this._eggPill = panel('EggPill', 360, 96, UI.BG, 20);
    this._eggPill.setParent(this.node);
    this._eggText = this.addLabelInside(this._eggPill, '', 22, UI.TEXT, 340, 40);
    this._eggText.node.setPosition(0, 18, 0);
    this._eggTf = uiNode('EggBar', 300, 14);
    this._eggBar = this._eggTf.addComponent(Graphics);
    this._eggTf.setParent(this._eggPill);
    this._eggTf.setPosition(0, -16, 0);

    // 底部提示
    this._hint = label('Hint', '按住拖动 · 轻抚 · 投喂 · 逗玩', 18, UI.TEXT_LIGHT, 560, 30);
    this._hint.setParent(this.node);
    this._hint.setPosition(0, -h / 2 + 32);

    // T16：陪伴爪印进度（无数字）
    this._pawPill = panel('PawPill', 360, 56, UI.BG, 26);
    this._pawPill.setParent(this.node);
    this._pawPill.setPosition(0, -h / 2 + 96);
    const pawLb = label('PawLabel', '陪伴', 16, UI.TEXT_LIGHT, 60, 26);
    pawLb.setParent(this._pawPill);
    pawLb.setPosition(-140, 0);
    const pawTf = uiNode('PawMarks', 300, 36);
    pawTf.setParent(this._pawPill);
    pawTf.setPosition(24, 0);
    this._pawG = pawTf.addComponent(Graphics);

    // T16：今日想见你标记
    this._missYouPill = panel('MissYouPill', 340, 44, new Color(255, 244, 224, 235), 22);
    this._missYouPill.setParent(this.node);
    this._missYouPill.setPosition(0, h / 2 - 136);
    this._missYouLb = this.addLabelInside(this._missYouPill, '', 17, UI.WARM_DARK, 320, 44);
    this._missYouPill.active = false;

    // T12：召回按钮（有宠物在外面时显示）
    this._recallBtn = button('RecallBtn', '召回', 150, 56, UI.BG, UI.TEXT, 20);
    this._recallBtn.setParent(this.node);
    this._recallBtn.setPosition(this.recallPos().x, this.recallPos().y);
    this._recallBtn.active = false;

    // T11/T13：调试面板（仅 ?dev=1）
    if (DebugTools.enabled) {
      this._devPanel = uiNode('DevPanel', 180, 200);
      this._devPanel.setParent(this.node);
      const labels = ['成长+24h', '快进1天', '快进7天'];
      labels.forEach((text, i) => {
        const b = button('DevBtn' + i, text, 150, 54, new Color(86, 110, 140, 235),
          new Color(255, 255, 255, 255), 18);
        b.setParent(this._devPanel!);
        const p = this.devPos(i);
        b.setPosition(p.x, p.y);
      });
    }

    // 拖拽食物点
    this._dragDot = circle('DragFood', 20, new Color(240, 200, 140, 255));
    this._dragDot.setParent(this.node);
    this._dragDot.active = false;

    // 台词气泡
    this._bubble = panel('Bubble', 420, 116, new Color(255, 255, 255, 240), 22);
    this._bubble.setParent(this.node);
    this._bubble.active = false;
    this._bubbleLb = this.addLabelInside(this._bubble, '', 20, UI.TEXT, 380, 96);
    this._bubbleLb.overflow = Label.Overflow.CLAMP;
    this._bubbleLb.enableWrapText = true;

    // Toast
    this._toast = panel('Toast', 420, 56, new Color(90, 74, 58, 210), 28);
    this._toast.setParent(this.node);
    this._toast.active = false;
    this._toast.setPosition(0, -h / 2 + 340);
    this._toastLb = this.addLabelInside(this._toast, '', 20, new Color(255, 255, 255, 255), 400, 56);
  }

  private addLabelInside(parent: Node, text: string, size: number, color: Color, w: number, h: number): Label {
    const n = label(parent.name + 'Label', text, size, color, w, h);
    n.setParent(parent);
    return n.getComponent(Label)!;
  }

  private refreshHud(): void {
    const save = GameSave.data;
    if (!save) return;
    if (this._foodLb) this._foodLb.string = `食物 ${save.food}`;
    if (this._dustLb) this._dustLb.string = `星尘 ${save.stardust}`;
  }

  private dishPos(): { x: number; y: number } {
    return { x: -this._w / 2 + 88, y: -this._h / 2 + 130 };
  }

  private albumButtonPos(): { x: number; y: number } {
    return { x: this._w / 2 - 92, y: this._h / 2 - 70 };
  }

  private showToast(text: string): void {
    if (!this._toast || !this._toastLb) return;
    this._toastLb.string = text;
    this._toast.active = true;
    this._toastTimer = 2.2;
  }

  private showGreeting(): void {
    const save = GameSave.data;
    if (!save) return;
    const pet = Collection.getActivePet(save);
    if (pet) DialogBubble.showGreeting(PetBehavior.pickGreetingLine(save, pet));
  }

  // ===== 气泡 =====

  private bindEvents(): void {
    Events.on(EventName.DialogRequest, this.onDialogRequest);
    Events.on(EventName.FoodChanged, this.onFoodChanged);
    Events.on(EventName.StardustChanged, this.onDustChanged);
    Events.on(EventName.PetInteracted, this.onInteracted);
    Events.on(EventName.ActivePetSwitched, this.onSwitch);
    Events.on(EventName.PetStageChanged, this.onStageChanged);
    Events.on(EventName.ExploreReturned, this.onExploreReturned);
    Events.on(EventName.MissYouToday, this.onMissYouToday);
    Events.on(EventName.PetBehaviorChanged, this.onBehaviorChanged);
  }

  private onDialogRequest = (text: unknown): void => {
    if (typeof text !== 'string' || !text) return;
    if (!this._bubble || !this._bubbleLb) return;
    this._bubbleLb.string = text;
    this._bubble.active = true;
    this._bubbleTimer = 3.2;
  };

  private onFoodChanged = (): void => this.refreshHud();
  private onDustChanged = (): void => this.refreshHud();

  private onInteracted = (petId: unknown, type: unknown): void => {
    console.log('[GameUI] MemoryEvent', type, 'pet=', petId);
  };

  private onSwitch = (): void => {
    this.refreshHud();
    this.refreshMissYou();
  };

  // ===== T11 阶段进阶演出 =====

  private onStageChanged = (petId: unknown, stage: unknown): void => {
    const save = GameSave.data;
    const pet = save?.pets.find(p => p.id === petId);
    if (!save || !pet) return;
    if (save.activePetId === pet.id) {
      this._petView?.playReaction('celebrate', 1.6);
    }
    let text = '';
    switch (stage as Stage) {
      case Stage.Baby:
        text = '它第一次站起来，摇摇晃晃地扑向你';
        break;
      case Stage.Adult:
        text = '学会了新动作，得意地等你夸它（现在可以拖到门口出门探险了）';
        break;
      case Stage.Final:
        text = '完全体达成！它围着你转了一圈又一圈';
        break;
      default:
        return;
    }
    this.showToast(this.stageText(stage as Stage));
    this.say(text);
    this.refreshHud();
    this.refreshMissYou();
  };

  // ===== T12 探索归来 =====

  private onExploreReturned = (_petId: unknown, result: unknown): void => {
    const r = result as ExploreResult | null;
    if (!r) return;
    let msg = r.story;
    if (r.foodGained > 0) msg += `（带回 ${r.foodGained} 份食物）`;
    if (r.eggGained) msg += r.eggQueued ? '（窝边多了一枚灵卵）' : '（还带回一枚灵卵）';
    this.say(msg);
    this.showToast(r.recalled ? '它提前回来了' : '探险归来');
    this.refreshHud();
  };

  // ===== T16 今日想见你 / 失落台词 =====

  private refreshMissYou(): void {
    const save = GameSave.data;
    if (!save) return;
    // 幂等：新孵化宠物当天也补选一次，避免"今日想见你"永远落在首批宠物上
    MissYouService.ensureDaily(save);
    const pet = MissYouService.current(save);
    if (!this._missYouPill || !this._missYouLb) return;
    if (!pet) {
      this._missYouPill.active = false;
      return;
    }
    const name = getSpecies(pet.speciesId)?.name ?? '';
    this._missYouLb.string = `今天想见你 · ${name}`;
    this._missYouPill.active = true;
  }

  private announceMissYou(): void {
    const save = GameSave.data;
    const pet = save ? MissYouService.current(save) : null;
    if (!pet || !save) return;
    if (save.activePetId === pet.id) {
      DialogBubble.show('今天特别想见到你呀');
    }
  }

  private onMissYouToday = (): void => {
    this.refreshMissYou();
    this.showToast('今天想见你 · 与它互动星尘翻倍');
  };

  private onBehaviorChanged = (petId: unknown, behavior: unknown): void => {
    if (behavior !== Behavior.Sad) return;
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet || pet.id !== petId) return;
    const now = Date.now();
    if (now - this._lastSadLineTs < 90_000) return;
    this._lastSadLineTs = now;
    if (DialogBubble.currentText) return;
    this.say(PetBehavior.pickIdleLine(save, pet, Behavior.Sad));
  };

  // ===== 新手三选一 =====

  private showOnboarding(): void {
    const options = Onboarding.rollStarterOptions();
    const w = this._w;
    const h = this._h;

    const root = uiNode('Onboarding', w, h);
    root.setParent(this.node);
    root.setPosition(0, 0, 0);
    this._onboard = root;

    // 深空仪式感背景（取代原来的一整块深棕遮罩）
    const bg = createOnboardingBackdrop(w, h);
    bg.setParent(root);

    const title = label('Title', '选 一 枚 灵 卵 吧', 38, new Color(255, 246, 230, 255), 600, 60);
    title.setParent(root);
    title.setPosition(0, h / 2 - 200);

    const sub = label('Sub', '它 们 都 在 等 你 回 家', 18, new Color(255, 226, 196, 185), 600, 32);
    sub.setParent(root);
    sub.setPosition(0, h / 2 - 274);

    this.drawOrnament(root, h / 2 - 238);

    // 三枚灵卵：配色按蛋 id 稳定生成、三枚互不相同，等权不含稀有度暗示
    const startStyle = hashId(options[0]) % EGG_STYLES.length;
    options.forEach((id, i) => {
      const style = EGG_STYLES[(startStyle + i) % EGG_STYLES.length];
      const x = (i - 1) * EGG_CX;

      // 先铺光台（含投影 / 光柱），再叠蛋，保证蛋压在光台之上
      const pedestal = createEggPedestal(style);
      pedestal.setParent(root);
      pedestal.setPosition(x, EGG_CY - 96);

      const egg = createEggNode(id, style);
      egg.setParent(root);
      egg.setPosition(x, EGG_CY);

      // 命中节点（点击热区由 tapOnboarding 统一判定）
      const slot = uiNode('EggSlot' + i, 200, 280);
      slot.setParent(root);
      slot.setPosition(x, EGG_CY);
      (slot as unknown as { __eggId?: string }).__eggId = id;
    });

    const hint = label('OnboardHint', '轻 触 · 带 它 回 家', 15, new Color(185, 207, 232, 115), 600, 28);
    hint.setParent(root);
    hint.setPosition(0, -372);
  }

  /** 标题下的细线 + 菱形装饰 */
  private drawOrnament(parent: Node, y: number): void {
    const n = uiNode('Ornament', this._w, 20);
    n.setParent(parent);
    n.setPosition(0, y);
    const g = n.addComponent(Graphics);
    g.lineWidth = 1;
    g.strokeColor = new Color(255, 217, 168, 65);
    g.moveTo(-156, 0);
    g.lineTo(-80, 0);
    g.stroke();
    g.strokeColor = new Color(255, 217, 168, 65);
    g.moveTo(80, 0);
    g.lineTo(156, 0);
    g.stroke();
    g.fillColor = new Color(255, 217, 168, 120);
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -80 : 80;
      g.moveTo(sx, 4.6);
      g.lineTo(sx + 2.4, 0);
      g.lineTo(sx, -4.6);
      g.lineTo(sx - 2.4, 0);
      g.close();
      g.fill();
    }
  }

  private tapOnboarding(x: number, y: number): void {
    if (!this._onboard) return;
    const save = GameSave.data;
    if (!save) return;
    for (let i = 0; i < 3; i++) {
      const cx = (i - 1) * EGG_CX;
      if (Math.abs(x - cx) <= 104 && Math.abs(y - EGG_CY) <= 132) {
        const card = this._onboard.getChildByName(`EggSlot${i}`);
        const id = (card as unknown as { __eggId?: string } | null)?.__eggId;
        if (id && Onboarding.pickStarter(save, id)) {
          GameSave.markDirty();
          this.hideOnboarding();
          this.refreshHud();
          this.showToast('它开始孵化了，试试长按蛋');
          DialogBubble.show('壳里传来轻轻的响动');
        }
        return;
      }
    }
  }

  private hideOnboarding(): void {
    this._onboard?.destroy();
    this._onboard = null;
  }

  // ===== 图鉴 =====

  private openAlbum(): void {
    const save = GameSave.data;
    if (!save || this._album) return;
    const w = this._w;
    const h = this._h;
    const root = uiNode('Album', w, h);
    root.setParent(this.node);
    this._album = root;

    const mask = panel('Mask', w, h, UI.MASK, 0);
    mask.setParent(root);

    const bg = panel('AlbumBg', 660, 1040, UI.BG_SOLID, 26);
    bg.setParent(root);
    bg.setPosition(0, 0);

    const title = label('AlbumTitle', '图鉴', 30, UI.TEXT, 200, 40);
    title.setParent(bg);
    title.setPosition(0, 480);

    const close = button('AlbumClose', '关闭', 120, 56, UI.WARM_DARK, new Color(255, 255, 255, 255), 20);
    close.setParent(bg);
    close.setPosition(240, 480);

    const grid = Collection.getGrid(save);
    const cols = 5;
    const cell = 108;
    const gap = 10;
    const startX = -((cols - 1) * (cell + gap)) / 2;
    const startY = 330;

    grid.forEach((entry, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (cell + gap);
      const cy = startY - row * (cell + gap);
      const owned = entry.owned;
      const c = panel('Cell' + i, cell, cell, owned ? UI.CARD : new Color(232, 222, 206, 255), 14);
      c.setParent(bg);
      c.setPosition(cx, cy);

      if (owned) {
        const pet = save.pets.find(p => p.speciesId === entry.species.id)!;
        const name = label('N' + i, entry.species.name, 21, UI.TEXT, cell - 12, 30);
        name.setParent(c);
        name.setPosition(0, 18);
        const st = label('S' + i, this.stageText(pet.stage), 17, UI.TEXT_LIGHT, cell - 12, 26);
        st.setParent(c);
        st.setPosition(0, -14);
        (c as unknown as { __petId?: string }).__petId = pet.id;
      } else {
        const q = label('Q' + i, '？', 28, new Color(170, 156, 138, 255), cell, cell);
        q.setParent(c);
        q.setPosition(0, 0);
      }
    });

    const all = label('AlbumHint', `已收集 ${save.pets.length} / ${grid.length}`, 18, UI.TEXT_LIGHT, 300, 30);
    all.setParent(bg);
    all.setPosition(0, -470);
  }

  private stageText(stage: Stage): string {
    switch (stage) {
      case Stage.Egg: return '蛋';
      case Stage.Baby: return '幼崽';
      case Stage.Adult: return '成体';
      case Stage.Final: return '完全体';
      default: return '';
    }
  }

  private tapAlbum(x: number, y: number): void {
    if (!this._album) return;
    const save = GameSave.data;
    if (!save) return;

    // 关闭
    if (Math.abs(x - 240) <= 70 && Math.abs(y - 480) <= 34) {
      this.closeAlbum();
      return;
    }

    const cols = 5;
    const cell = 108;
    const gap = 10;
    const startX = -((cols - 1) * (cell + gap)) / 2;
    const startY = 330;
    for (let i = 0; i < 25; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (cell + gap);
      const cy = startY - row * (cell + gap);
      if (Math.abs(x - cx) <= cell / 2 && Math.abs(y - cy) <= cell / 2) {
        const bg = this._album.getChildByName('AlbumBg');
        const c = bg?.getChildByName(`Cell${i}`);
        const petId = (c as unknown as { __petId?: string } | null)?.__petId;
        if (petId && Collection.switchActive(save, petId)) {
          GameSave.markDirty();
          this.closeAlbum();
          this.refreshHud();
          this.showGreeting();
        } else {
          this.showToast('它还没来小窝');
        }
        return;
      }
    }
  }

  private closeAlbum(): void {
    this._album?.destroy();
    this._album = null;
  }

  // ===== 破壳光效 =====

  private flashRarity(rarity: Rarity): void {
    const key = (rarity.charAt(0).toUpperCase() + rarity.slice(1)) as keyof typeof GameConfig.RARITY_FX;
    const hex = (GameConfig.RARITY_FX as Record<string, string | null>)[key];
    if (!hex) {
      this.showToast('破壳啦');
      return;
    }
    const color = new Color();
    Color.fromHEX(color, hex);
    color.a = 170;
    const flash = panel('HatchFlash', this._w, this._h, color, 0);
    flash.setParent(this.node);
    flash.setPosition(0, 0, 0);
    tween(flash).to(0.45, { scale: new Vec3(1.08, 1.08, 1) }).to(0.45, { scale: new Vec3(1, 1, 1) }).call(() => flash.destroy()).start();
    this.showToast(`${this.speciesNameOfRecent()} 破壳而出`);
  }

  private speciesNameOfRecent(): string {
    const save = GameSave.data;
    if (!save) return '小家伙';
    const pet = save.pets[save.pets.length - 1];
    return getSpecies(pet?.speciesId ?? '')?.name ?? '小家伙';
  }

  // ===== 拖拽食物 =====

  private moveDragDot(x: number, y: number): void {
    if (!this._dragDot) return;
    this._dragDot.active = true;
    this._dragDot.setPosition(x, y);
  }

  private hideDragDot(): void {
    if (this._dragDot) this._dragDot.active = false;
  }
}
