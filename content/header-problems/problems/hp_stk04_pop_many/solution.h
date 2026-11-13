// Reference solution: nothing has to be erased — the elements above mSize are
// simply no longer part of the stack — so removing k of them is one
// subtraction. The whole problem is the guard: mSize and k are BOTH size_t,
// so `mSize -= k` with k > mSize wraps around to a huge number instead of
// going negative, and the stack would claim to hold 2^64 - 1 elements.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "stack.h"
using namespace std;

template <typename T>
void CP::stack<T>::pop(size_t k)
{
  // Your code here
  if (k >= mSize)
    mSize = 0;
  else
    mSize -= k;
}

#endif
