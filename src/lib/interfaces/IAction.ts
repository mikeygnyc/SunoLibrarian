export interface IAction {
  action_type: string;
  disabled: boolean;
  visible: boolean;
}
export interface IActionConfig{
  actions: IAction[];
}