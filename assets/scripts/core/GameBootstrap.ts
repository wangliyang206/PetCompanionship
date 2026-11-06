import { _decorator, Component } from 'cc';
import { GameRoot } from './GameRoot';

const { ccclass } = _decorator;

/**
 * 场景入口组件（挂在 Main.scene 的 PetAnchor 上）。
 *
 * 为什么必须存在：Creator 预览只会打包「被场景/资源引用」的脚本，
 * 未被任何节点引用的脚本不会出现在 virtual:///prerequisite-imports/main，
 * 于是 GameRoot 的模块级自举不会执行 —— 预览里只剩静态的 Ground/Nest，
 * 表现就是「运行后一片灰、没有 UI、没有蛋和宠物」。构建（web/android）虽然会
 * 全量打包，但显式入口能保证预览与构建行为一致。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    onLoad(): void {
        GameRoot.bootstrap();
    }
}
