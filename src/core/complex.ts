/** Minimal immutable complex number type used throughout the NCIE engine. */
export class Complex {
  static readonly ZERO = new Complex(0, 0);
  static readonly ONE = new Complex(1, 0);

  readonly re: number;
  readonly im: number;

  constructor(re: number, im: number = 0) {
    this.re = re;
    this.im = im;
  }

  static fromPolar(r: number, theta: number): Complex {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
  }

  add(other: Complex): Complex {
    return new Complex(this.re + other.re, this.im + other.im);
  }

  sub(other: Complex): Complex {
    return new Complex(this.re - other.re, this.im - other.im);
  }

  mul(other: Complex): Complex {
    return new Complex(
      this.re * other.re - this.im * other.im,
      this.re * other.im + this.im * other.re,
    );
  }

  scale(k: number): Complex {
    return new Complex(this.re * k, this.im * k);
  }

  conj(): Complex {
    return new Complex(this.re, -this.im);
  }

  abs2(): number {
    return this.re * this.re + this.im * this.im;
  }

  abs(): number {
    return Math.sqrt(this.abs2());
  }
}
