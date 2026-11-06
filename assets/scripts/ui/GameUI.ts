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
  Input, Label, Node, tween, UIOpacity, Vec3, view,
} from 'cc';
import { GameConfig } from '../core/GameConfig';
import { GameSave } from '../core/GameSave';
import { EggSystem } from '../egg/EggSystem';
import { EggSource, Stage, Rarity } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { Collection } from '../collection/Collection';
import { Onboarding } from './Onboarding';
import { DialogBubble } from './DialogBubble';
import { PetBehavior } from '../pet/PetBehavior';
import { PetView } from '../pet/PetView';
import { TouchPet } from '../interaction/TouchPet';
import { DragFeed } from '../interaction/DragFeed';
import { PokePlay } from '../interaction/PokePlay';
import { TimeService } from '../core/TimeService';
import { getSpecies } from '../pet/PetDefs';
import { UI, button, circle, label, panel, uiNode } from './UiFactory';
import { EGG_STYLES, createEggNode, createEggPedestal, hashId } from './EggArt';
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

  private _toastTimer = 0;
  private _bubbleTimer = 0;
  private _petScreen = { x: 0, y: 0 };

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

    this.buildHud();
    this.bindEvents();

    input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

    this.refreshHud();
    if (GameSave.data && Onboarding.isFirstLaunch(GameSave.data)) {
      this.showOnboarding();
    } else {
      this.showGreeting();
    }
  }

  onDestroy(): void {
    input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    Events.off(EventName.DialogRequest, this.onDialogRequest);
  }

  // ===== 生命周期 =====

  update(dt: number): void {
    this.updatePetScreen();
    this.updateBubblePos();
    this.updateEggPill();
    this.updateToast(dt);
    this.updateBubbleTimer(dt);
    this.updateHold();
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
      return;
    }

    const total = (egg.source === EggSource.Starter ? GameConfig.EGG.STARTER_HATCH_MIN : GameConfig.EGG.NORMAL_HATCH_MIN) * 60_000;
    const remain = Math.max(0, egg.hatchesAt - now);
    const mm = Math.floor(remain / 60_000);
    const ss = Math.floor((remain % 60_000) / 1000);
    if (this._eggText) {
      this._eggText.string = `孵化中 ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
    if (this._eggBar) this.redrawBar(this._eggBar, total > 0 ? 1 - remain / total : 1);
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

  /** 长按蛋：每 0.5s 缩短 2 分钟 */
  private updateHold(): void {
    if (this._target !== 'pet' || this._moved > HIT.TAP) return;
    const save = GameSave.data;
    if (!save) return;
    const egg = PokePlay.getIncubatingEgg(save);
    if (!egg) return;
    const now = Date.now();
    if (now - this._pressTs < 500) return;
    if (now - this._lastEggTs < 450) return;
    this._lastEggTs = now;
    const reduce = PokePlay.longPressEgg(save, egg);
    if (reduce > 0) {
      this.showToast(`蛋壳震了一下（-${reduce / 60_000} 分钟）`);
      GameSave.markDirty();
    }
  }

  // ===== 输入 =====

  private toLocal(e: EventTouch): { x: number; y: number } {
    const p = e.getUILocation();
    return { x: p.x - this._w / 2, y: p.y - this._h / 2 };
  }

  private onTouchStart = (e: EventTouch): void => {
    const { x, y } = this.toLocal(e);
    this._startX = x;
    this._startY = y;
    this._downX = x;
    this._downY = y;
    this._moved = 0;
    this._pressTs = Date.now();
    this._target = '';

    if (this._onboard && this._onboard.active) {
      this.tapOnboarding(x, y);
      return;
    }
    if (this._album && this._album.active) {
      this.tapAlbum(x, y);
      return;
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

    if (this._target === 'pet' && this._moved > HIT.SWIPE) {
      this.petSwipe();
      return;
    }
    if (this._target === 'dish') {
      this.moveDragDot(x, y);
    }
  };

  private onTouchEnd = (e: EventTouch): void => {
    const { x, y } = this.toLocal(e);
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

  // ===== 互动动作 =====

  private petSwipe(): void {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return;
    const now = Date.now();
    if (now - this._lastPetTs < 320) return;
    this._lastPetTs = now;
    TouchPet.perform(save, pet);
    GameSave.markDirty();
    this.say(PetBehavior.pickInteractLine(save, pet, 'pet'));
  }

  private poke(): void {
    const save = GameSave.data;
    if (!save) return;
    const ready = EggSystem.findReadyEggs(save)[0];
    if (ready) {
      this.hatch(ready);
      return;
    }
    const pet = Collection.getActivePet(save);
    if (pet) {
      PokePlay.poke(save, pet);
      GameSave.markDirty();
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
    this.flashRarity(res.rarity);
    if (res.pet) {
      const line = PetBehavior.pickGreetingLine(save, res.pet);
      DialogBubble.show(line);
    } else {
      DialogBubble.show(`重复的灵卵化作 ${res.dupStardust} 星尘`);
    }
    this.refreshHud();
  }

  private say(text: string): void {
    DialogBubble.show(text);
  }

  // ===== HUD =====

  private buildHud(): void {
    const w = this._w;
    const h = this._h;

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

    // 孵化倒计时
    this._eggPill = panel('EggPill', 360, 96, UI.BG, 20);
    this._eggPill.setParent(this.node);
    this._eggPill.setPosition(0, -h / 2 + 240);
    this._eggText = this.addLabelInside(this._eggPill, '', 22, UI.TEXT, 340, 40);
    this._eggText.node.setPosition(0, 18, 0);
    this._eggTf = uiNode('EggBar', 300, 14);
    this._eggBar = this._eggTf.addComponent(Graphics);
    this._eggTf.setParent(this._eggPill);
    this._eggTf.setPosition(0, -16, 0);

    // 底部提示
    this._hint = label('Hint', '轻抚 · 投喂 · 逗玩', 18, UI.TEXT_LIGHT, 500, 30);
    this._hint.setParent(this.node);
    this._hint.setPosition(0, -h / 2 + 30);

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
