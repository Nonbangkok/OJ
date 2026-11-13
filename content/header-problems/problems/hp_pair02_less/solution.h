// Reference solution: lexicographic order — the first component decides, and
// only when it is a tie does the second one get a say. Written with the
// components' own < so it works for every T1/T2 the grader instantiates.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator<(const CP::pair<T1, T2> &other) const
{
  // Your code here
  if (first < other.first)
    return true;
  if (other.first < first)
    return false;
  return second < other.second;
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::make_min(const CP::pair<T1, T2> &other)
{
  // You MAY need to edit this function
  if (other < *this)
  {
    first = other.first;
    second = other.second;
  }
}

#endif
