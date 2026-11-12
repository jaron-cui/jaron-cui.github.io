/** Port of `libs/utils/torch/activations.py`. */
import * as torch from '../../torch';

export function identity(x: torch.Tensor): torch.Tensor {
  return x;
}

export function sigmoid(x: torch.Tensor): torch.Tensor {
  return torch.sigmoid(x);
}

export function tanh(x: torch.Tensor): torch.Tensor {
  return torch.tanh(x);
}

export function threshold(x: torch.Tensor): torch.Tensor {
  return x.gt(0.).float();
}

export function hardsigmoid(x: torch.Tensor): torch.Tensor {
  return torch.add(torch.mul(0.5, torch.functional.hardtanh(x, -1., 1.)), 0.5);
}

export function hardtanh(x: torch.Tensor): torch.Tensor {
  return torch.functional.hardtanh(x, -1., 1.);
}

export function relu(x: torch.Tensor): torch.Tensor {
  return torch.relu(x);
}

export function retanh(x: torch.Tensor): torch.Tensor {
  return torch.relu(torch.tanh(x));
}

export function unitrelu(x: torch.Tensor): torch.Tensor {
  return torch.clamp(x, { min: 0, max: 1 });
}
