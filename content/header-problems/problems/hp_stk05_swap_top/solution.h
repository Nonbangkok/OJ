// Reference solution: an exchange of two array slots through a temporary, in
// O(1). Two details carry the problem:
//   * fewer than two elements means "do nothing" — with size_t indices,
//     mSize - 2 on a stack of one element is not -1 but 2^64 - 1;
//   * the exchange needs a temporary of type T. T is not always a number, so
//     arithmetic swaps (a += b; b = a - b; ...) are not an option.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::swap_top()
{
  // Your code here
  if (mSize < 2)
    return;
  T hold = mData[mSize - 1];
  mData[mSize - 1] = mData[mSize - 2];
  mData[mSize - 2] = hold;
}

#endif
