// Reference solution: the three-reversal trick.
//
// Rotating left by k is the same as
//     reverse the first k, reverse the rest, then reverse the whole thing.
// On 1 2 3 4 5 with k = 2:
//     2 1 3 4 5  ->  2 1 5 4 3  ->  3 4 5 1 2
//
// Each of the three loops swaps elements in place, so the whole rotation
// costs about 3n/2 swaps — O(n) time — and the only extra memory is the one
// temporary element inside the swap. No buffer, which is what keeps the
// 2,000,000-element long long case inside the 32 MB limit.
//
// k is reduced modulo mSize first: rotating by the size (or any multiple of
// it) leaves the vector alone, and without the reduction the second loop's
// bounds would be nonsense.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "vector.h"
using namespace std;

template <typename T>
void CP::vector<T>::rotate(size_t k)
{
  // Your code here
  if (mSize < 2)
  {
    return;
  }
  k = k % mSize;
  if (k == 0)
  {
    return;
  }

  // reverse [0, k)
  for (size_t a = 0, b = k - 1; a < b; a++, b--)
  {
    T hold = mData[a];
    mData[a] = mData[b];
    mData[b] = hold;
  }
  // reverse [k, mSize)
  for (size_t a = k, b = mSize - 1; a < b; a++, b--)
  {
    T hold = mData[a];
    mData[a] = mData[b];
    mData[b] = hold;
  }
  // reverse the whole vector
  for (size_t a = 0, b = mSize - 1; a < b; a++, b--)
  {
    T hold = mData[a];
    mData[a] = mData[b];
    mData[b] = hold;
  }
}

#endif
